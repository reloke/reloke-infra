/**
 * matching-worker.service.ts
 *
 * Worker pool for distributed matching processing across multiple VMs.
 *
 * ARCHITECTURE:
 * - Each VM runs N workers (configurable via MATCHING_WORKER_CONCURRENCY)
 * - Each worker runs an independent claim/process loop
 * - Workers claim tasks atomically using Postgres SKIP LOCKED
 * - No external coordination needed (Redis, ZooKeeper, etc.)
 *
 * WHY SKIP LOCKED:
 * When multiple workers execute SELECT ... FOR UPDATE SKIP LOCKED:
 * - Each worker gets a DIFFERENT set of rows
 * - Rows locked by other workers are SKIPPED (not waited for)
 * - Result: True parallel processing with no coordination overhead
 *
 * This pattern is used by many production systems (Sidekiq Pro, Que, etc.)
 * and is the recommended approach for job queues without external deps.
 */

import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MatchAlgorithmService } from './match-algorithm.service';
import { NotificationOutboxService } from './notification-outbox.service';
import {
  MatchingConfigService,
  MatchingTaskStatus,
} from '../config/matching.config';
import { randomUUID } from 'crypto';

interface ClaimedTask {
  id: number;
  intentId: number;
  attempts: number;
  maxAttempts: number;
}

@Injectable()
export class MatchingWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MatchingWorkerService.name);
  private workers: Promise<void>[] = [];
  private isShuttingDown = false;
  private instanceId: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly matchAlgorithm: MatchAlgorithmService,
    private readonly config: MatchingConfigService,
    private readonly notificationOutboxService: NotificationOutboxService,
  ) {
    this.instanceId = this.config.instanceId;
  }

  /**
   * Start worker pool on module initialization.
   * Waits a short delay to allow the application to fully bootstrap.
   */
  async onModuleInit(): Promise<void> {
    if (!this.config.cronEnabled) {
      this.logger.warn(
        'Matching workers disabled (MATCHING_CRON_ENABLED=false)',
      );
      return;
    }

    const concurrency = this.config.workerConcurrency;
    this.logger.log(
      `Starting ${concurrency} matching workers on instance ${this.instanceId}`,
    );

    // Wait a bit for the app to fully start
    await this.sleep(5000);

    // Start worker loops
    for (let i = 0; i < concurrency; i++) {
      const workerId = `${this.instanceId}-worker-${i}`;
      this.workers.push(this.runWorkerLoop(workerId));
    }

    this.logger.log(`${concurrency} workers started`);
  }

  /**
   * Graceful shutdown: stop accepting new work and wait for current tasks.
   */
  async onModuleDestroy(): Promise<void> {
    this.logger.log('Shutting down matching workers...');
    this.isShuttingDown = true;

    // Wait for all workers to complete their current task
    await Promise.allSettled(this.workers);

    this.logger.log('All workers stopped');
  }

  /**
   * Main worker loop.
   * Continuously claims and processes tasks until shutdown.
   */
  private async runWorkerLoop(workerId: string): Promise<void> {
    this.logger.debug(`[${workerId}] Started`);

    while (!this.isShuttingDown) {
      try {
        const tasks = await this.claimBatch(workerId);

        if (tasks.length === 0) {
          // No work available, wait before retrying
          await this.sleep(1000);
          continue;
        }

        this.logger.debug(`[${workerId}] Claimed ${tasks.length} tasks`);

        // Process each task sequentially
        for (const task of tasks) {
          if (this.isShuttingDown) break;
          await this.processTask(task, workerId);
        }
      } catch (error) {
        this.logger.error(`[${workerId}] Loop error: ${error.message}`);
        await this.sleep(5000); // Back off on errors
      }
    }

    this.logger.debug(`[${workerId}] Stopped`);
  }

  /**
   * Claim a batch of tasks atomically using SKIP LOCKED.
   *
   * This is the key to multi-VM scalability:
   * - SELECT FOR UPDATE SKIP LOCKED gets only rows not locked by others
   * - The update within the same transaction marks them as RUNNING
   * - Other workers trying to claim see different rows
   *
   * @param workerId - Identifier for this worker (for debugging)
   * @returns Array of claimed tasks
   */
  private async claimBatch(workerId: string): Promise<ClaimedTask[]> {
    // Use taskClaimBatchSize (NOT sweepLimit or candidateLimit)
    const batchSize = this.config.taskClaimBatchSize;
    const runId = randomUUID();

    // Use raw SQL for SKIP LOCKED - Prisma doesn't support it natively
    // This is a single atomic transaction: select + update
    const result = await this.prisma.safeTransaction(async (tx) => {
      // Step 1: Select available tasks with SKIP LOCKED
      // FOR UPDATE prevents other workers from taking these rows
      // SKIP LOCKED means rows already locked by another worker are ignored
      // Note: Cast batchSize to bigint for Postgres LIMIT clause
      const tasks = await tx.$queryRaw<ClaimedTask[]>`
        SELECT id, "intentId", attempts, "maxAttempts"
        FROM "MatchingTask"
        WHERE status = 'PENDING'
          AND "availableAt" <= NOW()
        ORDER BY "createdAt" ASC
        LIMIT ${batchSize}::bigint
        FOR UPDATE SKIP LOCKED
      `;

      if (tasks.length === 0) {
        return [];
      }

      // Step 2: Mark selected tasks as RUNNING
      const taskIds = tasks.map((t) => t.id);
      await tx.$executeRaw`
        UPDATE "MatchingTask"
        SET status = 'RUNNING',
            "lockedAt" = NOW(),
            "lockedBy" = ${workerId},
            "runId" = ${runId},
            "updatedAt" = NOW()
        WHERE id = ANY(${taskIds})
      `;

      return tasks;
    });

    return result;
  }

  /**
   * Process a single matching task.
   *
   * STEPS:
   * 1. Lock the intent (set matchingProcessingUntil)
   * 2. Run incremental matching for this intent
   * 3. On success: mark task DONE, unlock intent
   * 4. On failure: increment attempts, retry or mark FAILED
   */
  private async processTask(
    task: ClaimedTask,
    workerId: string,
  ): Promise<void> {
    const startTime = Date.now();
    const runId = randomUUID();

    this.logger.debug(
      `[${workerId}] Processing task ${task.id} for intent ${task.intentId}`,
    );

    try {
      // Step 1: Lock the intent
      // This prevents refunds and other operations during matching
      const lockUntil = new Date(Date.now() + this.config.lockTtlMs);
      await this.prisma.intent.update({
        where: { id: task.intentId },
        data: {
          matchingProcessingUntil: lockUntil,
          matchingProcessingBy: workerId,
        },
      });

      // Step 2: Run matching algorithm for this intent
      // This is where the actual matching logic happens
      const matchCount = await this.matchAlgorithm.matchForIntent(
        task.intentId,
        runId,
      );

      // Step 3: Mark task as DONE
      await this.prisma.matchingTask.update({
        where: { id: task.id },
        data: {
          status: MatchingTaskStatus.DONE,
          updatedAt: new Date(),
        },
      });

      // Step 4: Unlock intent and update timestamps
      await this.prisma.intent.update({
        where: { id: task.intentId },
        data: {
          matchingProcessingUntil: null,
          matchingProcessingBy: null,
          lastMatchingProcessedAt: new Date(),
        },
      });

      const duration = Date.now() - startTime;
      this.logger.log(
        `[${workerId}] Task ${task.id} completed: ${matchCount} matches in ${duration}ms`,
      );

      // Flush outbox for this run to send emails immediately after commit
      // This is crash-safe: if flush fails, the background processor will retry
      if (matchCount > 0) {
        this.flushOutboxAsync(runId, workerId);
      }
    } catch (error) {
      await this.handleTaskError(task, workerId, error);
    }
  }

  /**
   * Handle task processing error with retry logic.
   *
   * RETRY STRATEGY:
   * - Exponential backoff: 30s, 2m, 10m, 30m, 1h
   * - Max attempts configurable (default 5)
   * - After max attempts: mark as FAILED, send alert
   */
  private async handleTaskError(
    task: ClaimedTask,
    workerId: string,
    error: Error,
  ): Promise<void> {
    const newAttempts = task.attempts + 1;
    const errorMessage = error.message.substring(0, 4000); // Truncate for DB

    this.logger.error(
      `[${workerId}] Task ${task.id} failed (attempt ${newAttempts}/${task.maxAttempts}): ${error.message}`,
    );

    try {
      // Always unlock the intent first
      await this.prisma.intent.update({
        where: { id: task.intentId },
        data: {
          matchingProcessingUntil: null,
          matchingProcessingBy: null,
        },
      });

      if (newAttempts >= task.maxAttempts) {
        // Max retries reached - mark as FAILED
        await this.prisma.matchingTask.update({
          where: { id: task.id },
          data: {
            status: MatchingTaskStatus.FAILED,
            attempts: newAttempts,
            lastError: errorMessage,
            updatedAt: new Date(),
          },
        });

        this.logger.error(
          `[${workerId}] Task ${task.id} permanently failed after ${newAttempts} attempts`,
        );

        // TODO: Send alert to ops team
        // await this.alertService.sendTaskFailedAlert(task.id, task.intentId, errorMessage);
      } else {
        // Retry with exponential backoff
        const retryDelay = this.config.getRetryDelayMs(newAttempts - 1);
        const availableAt = new Date(Date.now() + retryDelay);

        await this.prisma.matchingTask.update({
          where: { id: task.id },
          data: {
            status: MatchingTaskStatus.PENDING, // Reset to PENDING for retry
            attempts: newAttempts,
            lastError: errorMessage,
            availableAt,
            lockedAt: null,
            lockedBy: null,
            runId: null,
            updatedAt: new Date(),
          },
        });

        this.logger.warn(
          `[${workerId}] Task ${task.id} scheduled for retry at ${availableAt.toISOString()}`,
        );
      }
    } catch (updateError) {
      this.logger.error(
        `[${workerId}] Failed to update task ${task.id} after error: ${updateError.message}`,
      );
    }
  }

  /**
   * Utility: sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get worker pool status for health checks
   */
  getStatus(): {
    instanceId: string;
    workerCount: number;
    isShuttingDown: boolean;
  } {
    return {
      instanceId: this.instanceId,
      workerCount: this.workers.length,
      isShuttingDown: this.isShuttingDown,
    };
  }

  /**
   * Flush outbox for a specific run asynchronously (fire-and-forget)
   * Sends aggregated emails for all participants in this matching run.
   * If this fails, the background outbox processor will retry.
   */
  private async flushOutboxAsync(
    runId: string,
    workerId: string,
  ): Promise<void> {
    try {
      const sentCount = await this.notificationOutboxService.flushForRun(runId);
      if (sentCount > 0) {
        this.logger.log(
          `[${workerId}] Flushed outbox for run ${runId}: ${sentCount} emails sent`,
        );
      }
    } catch (error) {
      this.logger.error(
        `[${workerId}] Failed to flush outbox for run ${runId}: ${error.message}`,
      );
      // Don't throw - outbox processor will handle retries
    }
  }
}
