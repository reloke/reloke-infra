/**
 * matching-cron.service.ts
 *
 * Maintenance cron for the distributed matching system.
 *
 * ============================================================
 * ARCHITECTURE
 * ============================================================
 *
 * This cron is now ONLY for maintenance tasks!
 * The actual matching work is done by MatchingWorkerService.
 *
 * MAINTENANCE TASKS (every 1 minute):
 * 1. Release stale tasks: RUNNING tasks that exceeded lock TTL
 * 2. Release stale intents: intents with expired matchingProcessingUntil
 * 3. Sweep for new tasks: find eligible intents and enqueue them
 * 4. Cleanup old tasks: delete DONE/FAILED tasks older than 24h
 *
 * WHY SEPARATE FROM WORKERS:
 * - Maintenance should run on a single VM (via Cron decorator)
 * - Workers run on ALL VMs for parallel processing
 * - This separation ensures maintenance is idempotent
 *
 * ============================================================
 * DEBUG: HOW TO DIAGNOSE A HUNG MAINTENANCE
 * ============================================================
 *
 * 1. Look for logs with "maintenance_start" - this shows runId
 * 2. Each step logs "step_start" then "step_end" with durationMs
 * 3. If you see "step_start" without "step_end" for the same step,
 *    that step is hung
 * 4. If you see "step_timeout", the step exceeded the timeout
 * 5. Enable PRISMA_LOG_QUERIES=true to see the last DB query
 *
 * Database debugging:
 * - Check pg_stat_activity for long-running queries
 * - Check pg_locks for blocked queries
 * - See docs/DEBUG_MATCHING_FREEZE.md for commands
 */

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import {
  MatchingConfigService,
  MatchingTaskStatus,
} from '../config/matching.config';
import { MatchingEnqueueService } from './matching-enqueue.service';
import { randomUUID } from 'crypto';

/**
 * Result of a maintenance run for logging and monitoring
 */
interface MaintenanceResult {
  staleTasks: number;
  staleIntents: number;
  enqueuedIntents: number;
  cleanedTasks: number;
}

/**
 * Structured log entry for maintenance operations
 */
interface MaintenanceLogEntry {
  event: string;
  runId: string;
  instanceId: string;
  step?: string;
  durationMs?: number;
  count?: number;
  error?: string;
  config?: Record<string, unknown>;
}

@Injectable()
export class MatchingCronService implements OnModuleInit {
  private readonly logger = new Logger(MatchingCronService.name);
  private isMaintenanceRunning = false;
  private currentRunId: string | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: MatchingConfigService,
    private readonly enqueueService: MatchingEnqueueService,
  ) {}

  /**
   * Log status on startup and show config summary
   */
  onModuleInit() {
    if (!this.config.cronEnabled) {
      this.logger.log(
        'Matching cron is DISABLED (MATCHING_CRON_ENABLED=false)',
      );
      return;
    }

    // Log full config summary at startup
    const configSummary = this.config.getConfigSummary();
    this.logger.log(
      `Matching cron initialized with config: ${JSON.stringify(configSummary)}`,
    );

    // Run initial maintenance after 15 seconds
    // (workers start after 5s, so this ensures they're ready)
    setTimeout(() => {
      this.logger.log('Running initial maintenance sweep...');
      this.runMaintenanceJob();
    }, 15000);
  }

  /**
   * MAINTENANCE CRON: runs every 1 minute
   *
   * This is the heartbeat of the matching system.
   * It ensures:
   * - Failed workers don't leave tasks stuck forever
   * - Intents that should be processed get enqueued
   * - Old completed tasks are cleaned up
   */
  @Cron('0 * * * * *') // Every minute, at second 0
  async handleMaintenanceCron() {
    if (!this.config.cronEnabled) {
      return;
    }

    await this.runMaintenanceJob();
  }

  /**
   * Execute maintenance job with concurrency guard and timeout protection.
   *
   * IMPORTANT: Every step is wrapped with:
   * - Step-level logging (start/end with duration)
   * - Timeout protection (step cannot hang forever)
   * - Error handling (one step failing doesn't block others)
   */
  private async runMaintenanceJob(): Promise<void> {
    // Prevent concurrent runs (unlikely with 1-min interval, but safe)
    if (this.isMaintenanceRunning) {
      this.logger.debug(
        `Maintenance already running (runId=${this.currentRunId}), skipping`,
      );
      return;
    }

    // Generate unique ID for this maintenance run
    const runId = `maint-${Date.now()}-${randomUUID().slice(0, 8)}`;
    this.currentRunId = runId;
    this.isMaintenanceRunning = true;
    const startTime = Date.now();

    // Log maintenance start with full config context
    this.logMaintenance({
      event: 'maintenance_start',
      runId,
      instanceId: this.config.instanceId,
      config: {
        sweepLimit: this.config.sweepLimit,
        taskClaimBatchSize: this.config.taskClaimBatchSize,
        lockTtlMs: this.config.lockTtlMs,
        maintenanceStepTimeoutMs: this.config.maintenanceStepTimeoutMs,
        workerConcurrency: this.config.workerConcurrency,
      },
    });

    const result: MaintenanceResult = {
      staleTasks: 0,
      staleIntents: 0,
      enqueuedIntents: 0,
      cleanedTasks: 0,
    };

    try {
      // Step 1: Release stale RUNNING tasks
      // These are tasks where the worker crashed or timed out
      result.staleTasks = await this.runStepWithTimeout(
        runId,
        'releaseStaleTasks',
        () => this.releaseStaleTask(),
      );

      // Step 2: Release stale intent locks
      // These are intents where matchingProcessingUntil is in the past
      result.staleIntents = await this.runStepWithTimeout(
        runId,
        'releaseStaleIntents',
        () => this.releaseStaleIntents(),
      );

      // Step 3: Sweep for eligible intents and enqueue them
      result.enqueuedIntents = await this.runStepWithTimeout(
        runId,
        'sweepEligibleIntents',
        () => this.enqueueService.sweepEligibleIntents(),
      );

      // Step 4: Cleanup old DONE/FAILED tasks (keep last 24h for debugging)
      result.cleanedTasks = await this.runStepWithTimeout(
        runId,
        'cleanupOldTasks',
        () => this.cleanupOldTasks(),
      );

      const durationMs = Date.now() - startTime;

      // Log maintenance completion
      this.logMaintenance({
        event: 'maintenance_end',
        runId,
        instanceId: this.config.instanceId,
        durationMs,
      });

      // Only log summary if something happened or in debug mode
      if (
        result.staleTasks > 0 ||
        result.staleIntents > 0 ||
        result.enqueuedIntents > 0 ||
        result.cleanedTasks > 0
      ) {
        this.logger.log(
          `[${runId}] Maintenance completed: ` +
            `staleTasks=${result.staleTasks}, staleIntents=${result.staleIntents}, ` +
            `enqueued=${result.enqueuedIntents}, cleaned=${result.cleanedTasks} (${durationMs}ms)`,
        );
      } else if (this.config.debugEnabled) {
        this.logger.debug(
          `[${runId}] Maintenance completed: no actions needed (${durationMs}ms)`,
        );
      }
    } catch (error) {
      const durationMs = Date.now() - startTime;
      this.logMaintenance({
        event: 'maintenance_error',
        runId,
        instanceId: this.config.instanceId,
        durationMs,
        error: error.message,
      });
      this.logger.error(
        `[${runId}] Maintenance failed after ${durationMs}ms: ${error.message}`,
        error.stack,
      );
    } finally {
      // CRITICAL: Always release the lock, even on error
      this.isMaintenanceRunning = false;
      this.currentRunId = null;
    }
  }

  /**
   * Run a maintenance step with timeout protection.
   *
   * WHY TIMEOUT:
   * - A hung DB query could block maintenance forever
   * - Without timeout, isMaintenanceRunning stays true forever
   * - This causes "Maintenance already running" spam in logs
   *
   * HOW IT WORKS:
   * - Promise.race() between the actual work and a timeout timer
   * - If timeout wins, we log and throw, releasing the lock
   * - The underlying query may still complete, but we've moved on
   *
   * @param runId - Maintenance run identifier for log correlation
   * @param stepName - Name of the step for logging
   * @param stepFn - The async function to execute
   * @returns The result of stepFn, or throws on timeout
   */
  private async runStepWithTimeout<T>(
    runId: string,
    stepName: string,
    stepFn: () => Promise<T>,
  ): Promise<T> {
    const timeoutMs = this.config.maintenanceStepTimeoutMs;
    const stepStartTime = Date.now();

    // Log step start
    this.logMaintenance({
      event: 'step_start',
      runId,
      instanceId: this.config.instanceId,
      step: stepName,
    });

    try {
      // Create timeout promise
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Step ${stepName} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      });

      // Race between actual work and timeout
      const result = await Promise.race([stepFn(), timeoutPromise]);
      const durationMs = Date.now() - stepStartTime;

      // Log step completion
      this.logMaintenance({
        event: 'step_end',
        runId,
        instanceId: this.config.instanceId,
        step: stepName,
        durationMs,
        count: typeof result === 'number' ? result : undefined,
      });

      return result;
    } catch (error) {
      const durationMs = Date.now() - stepStartTime;

      // Distinguish timeout from other errors
      if (error.message.includes('timed out')) {
        this.logMaintenance({
          event: 'step_timeout',
          runId,
          instanceId: this.config.instanceId,
          step: stepName,
          durationMs,
          error: error.message,
        });
        this.logger.error(
          `[${runId}] TIMEOUT: ${stepName} exceeded ${timeoutMs}ms - possible hung query or lock`,
        );
      } else {
        this.logMaintenance({
          event: 'step_error',
          runId,
          instanceId: this.config.instanceId,
          step: stepName,
          durationMs,
          error: error.message,
        });
      }

      throw error;
    }
  }

  /**
   * Release tasks that have been RUNNING longer than the lock TTL.
   *
   * WHY THIS HAPPENS:
   * - A worker crashed mid-processing
   * - A worker was killed (deployment, OOM, etc.)
   * - Network issue caused DB connection loss
   *
   * The task is reset to PENDING so another worker can pick it up.
   * Note: We don't increment attempts because this wasn't a real failure.
   */
  private async releaseStaleTask(): Promise<number> {
    const lockTtlMs = this.config.lockTtlMs;
    const staleThreshold = new Date(Date.now() - lockTtlMs);

    const result = await this.prisma.matchingTask.updateMany({
      where: {
        status: MatchingTaskStatus.RUNNING,
        lockedAt: { lt: staleThreshold },
      },
      data: {
        status: MatchingTaskStatus.PENDING,
        lockedAt: null,
        lockedBy: null,
        runId: null,
        // Don't increment attempts - this wasn't a real failure
        lastError: 'Released by maintenance cron: lock TTL exceeded',
        updatedAt: new Date(),
      },
    });

    if (result.count > 0) {
      this.logger.warn(
        `Released ${result.count} stale tasks (lockedAt < ${staleThreshold.toISOString()})`,
      );
    }

    return result.count;
  }

  /**
   * Release intents with expired processing locks.
   *
   * The matchingProcessingUntil field is set by workers to:
   * 1. Block refund requests during matching
   * 2. Prevent other workers from processing the same intent
   *
   * If the lock expires, it means the worker didn't complete successfully.
   */
  private async releaseStaleIntents(): Promise<number> {
    const result = await this.prisma.intent.updateMany({
      where: {
        matchingProcessingUntil: { lt: new Date() },
        // Only update if actually locked
        NOT: { matchingProcessingUntil: null },
      },
      data: {
        matchingProcessingUntil: null,
        matchingProcessingBy: null,
      },
    });

    if (result.count > 0) {
      this.logger.warn(`Released ${result.count} stale intent locks`);
    }

    return result.count;
  }

  /**
   * Cleanup old DONE/FAILED tasks to prevent table bloat.
   * Keeps tasks for 24 hours for debugging purposes.
   */
  private async cleanupOldTasks(): Promise<number> {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago

    const result = await this.prisma.matchingTask.deleteMany({
      where: {
        status: { in: [MatchingTaskStatus.DONE, MatchingTaskStatus.FAILED] },
        updatedAt: { lt: cutoff },
      },
    });

    return result.count;
  }

  /**
   * Structured logging helper for maintenance operations.
   * Makes logs grep-able and parseable by log aggregators.
   */
  private logMaintenance(entry: MaintenanceLogEntry): void {
    const level =
      entry.event.includes('error') || entry.event.includes('timeout')
        ? 'error'
        : this.config.debugEnabled
          ? 'log'
          : 'debug';

    const message = JSON.stringify(entry);

    if (level === 'error') {
      this.logger.error(message);
    } else if (level === 'log') {
      this.logger.log(message);
    } else {
      this.logger.debug(message);
    }
  }

  /**
   * Get maintenance status for health checks
   */
  getStatus(): {
    cronEnabled: boolean;
    isMaintenanceRunning: boolean;
    currentRunId: string | null;
    lockTtlMs: number;
    triangleEnabled: boolean;
    config: Record<string, unknown>;
  } {
    return {
      cronEnabled: this.config.cronEnabled,
      isMaintenanceRunning: this.isMaintenanceRunning,
      currentRunId: this.currentRunId,
      lockTtlMs: this.config.lockTtlMs,
      triangleEnabled: this.config.triangleEnabled,
      config: this.config.getConfigSummary(),
    };
  }

  /**
   * Manual trigger for maintenance (for testing/debugging)
   */
  async triggerManualMaintenance(): Promise<
    MaintenanceResult & { runId: string }
  > {
    if (this.isMaintenanceRunning) {
      throw new Error(
        `Maintenance already running (runId=${this.currentRunId})`,
      );
    }

    const runId = `manual-${Date.now()}-${randomUUID().slice(0, 8)}`;
    this.currentRunId = runId;
    this.isMaintenanceRunning = true;

    const result: MaintenanceResult = {
      staleTasks: 0,
      staleIntents: 0,
      enqueuedIntents: 0,
      cleanedTasks: 0,
    };

    try {
      result.staleTasks = await this.runStepWithTimeout(
        runId,
        'releaseStaleTasks',
        () => this.releaseStaleTask(),
      );
      result.staleIntents = await this.runStepWithTimeout(
        runId,
        'releaseStaleIntents',
        () => this.releaseStaleIntents(),
      );
      result.enqueuedIntents = await this.runStepWithTimeout(
        runId,
        'sweepEligibleIntents',
        () => this.enqueueService.sweepEligibleIntents(),
      );
      result.cleanedTasks = await this.runStepWithTimeout(
        runId,
        'cleanupOldTasks',
        () => this.cleanupOldTasks(),
      );

      return { ...result, runId };
    } finally {
      this.isMaintenanceRunning = false;
      this.currentRunId = null;
    }
  }
}
