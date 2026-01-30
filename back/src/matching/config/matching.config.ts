/**
 * matching.config.ts
 *
 * Centralized configuration for the matching system.
 * All values are loaded from environment variables via ConfigService,
 * with sensible defaults for development.
 *
 * ============================================================
 * CONFIGURATION VARIABLES REFERENCE
 * ============================================================
 *
 * WORKER CONFIGURATION:
 *   MATCHING_TASK_CLAIM_BATCH_SIZE  - Tasks claimed per worker batch (default: 50)
 *   MATCHING_WORKER_CONCURRENCY    - Parallel workers per VM (default: 4)
 *   MATCHING_CRON_LOCK_TTL_MS      - Task lock timeout (default: 660000ms = 11min)
 *   MATCHING_MAX_ATTEMPTS          - Max retry attempts (default: 5)
 *   MATCHING_RETRY_DELAYS_MS       - Exponential backoff delays (default: 30s,2m,10m,30m,1h)
 *
 * SWEEP (CRON) CONFIGURATION:
 *   MATCHING_SWEEP_LIMIT           - Max intents to enqueue per sweep (default: 200)
 *   MATCHING_ENQUEUE_INTERVAL_MINUTES - Re-enqueue interval (default: 10)
 *
 * ALGORITHM CONFIGURATION:
 *   MATCHING_CANDIDATE_LIMIT       - Max candidates per intent (default: 200)
 *   TRIANGLE_MATCHING_ENABLED      - Enable 3-way matching (default: true)
 *
 * MAINTENANCE CONFIGURATION:
 *   MATCHING_MAINTENANCE_STEP_TIMEOUT_MS - Timeout per maintenance step (default: 15000)
 *
 * REFUND CONFIGURATION:
 *   REFUND_REBUY_COOLDOWN_DAYS     - Days before repurchase after refund (default: 14)
 *
 * DEBUG CONFIGURATION:
 *   MATCHING_DEBUG                 - Enable verbose logging (default: false)
 *   MATCHING_TRACE_USER_A          - User ID for pair tracing
 *   MATCHING_TRACE_USER_B          - User ID for pair tracing
 *   PRISMA_LOG_QUERIES             - Log all Prisma queries (default: false)
 *
 * INSTANCE CONFIGURATION:
 *   MATCHING_INSTANCE_ID           - Custom instance identifier
 *   MATCHING_CRON_ENABLED          - Enable/disable all matching (default: true)
 *
 * See docs/CHANGES_MATCHING.md for architecture details.
 */

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Task status enum for MatchingTask
 */
export enum MatchingTaskStatus {
  PENDING = 'PENDING',
  RUNNING = 'RUNNING',
  DONE = 'DONE',
  FAILED = 'FAILED',
}

/**
 * Task type enum for MatchingTask
 */
export enum MatchingTaskType {
  MATCHING = 'MATCHING',
}

/**
 * Notification types for NotificationLog
 */
export enum NotificationType {
  MATCHES_FOUND = 'MATCHES_FOUND',
  REFUND_CONFIRMED = 'REFUND_CONFIRMED',
  PAYMENT_SUCCESS = 'PAYMENT_SUCCESS',
}

/**
 * Error codes for typed exceptions
 */
export enum MatchingErrorCode {
  MATCHING_IN_PROGRESS = 'MATCHING_IN_PROGRESS',
  REFUND_COOLDOWN_ACTIVE = 'REFUND_COOLDOWN_ACTIVE',
  MATCH_NOT_FOUND = 'MATCH_NOT_FOUND',
  INVALID_STATUS_TRANSITION = 'INVALID_STATUS_TRANSITION',
  NO_CREDITS_AVAILABLE = 'NO_CREDITS_AVAILABLE',
  INTENT_NOT_FOUND = 'INTENT_NOT_FOUND',
}

@Injectable()
export class MatchingConfigService {
  constructor(private readonly configService: ConfigService) {}

  // ============================================================
  // WORKER CONFIGURATION
  // ============================================================

  /**
   * Number of tasks to claim per worker batch.
   * Each worker claims this many tasks atomically using SKIP LOCKED.
   *
   * WHY THIS VALUE:
   * - Too low (10): Excessive DB round-trips, workers idle between claims
   * - Too high (500): One worker hogs all tasks, others starve
   * - Recommended: 50-150 for balanced distribution
   *
   * Default: 50
   */
  get taskClaimBatchSize(): number {
    const value = this.configService.get<string>(
      'MATCHING_TASK_CLAIM_BATCH_SIZE',
    );
    return value ? parseInt(value, 10) : 50;
  }

  /**
   * @deprecated Use taskClaimBatchSize instead. Kept for backward compatibility.
   */
  get batchSize(): number {
    // First check new var, fallback to old var, then default
    const newValue = this.configService.get<string>(
      'MATCHING_TASK_CLAIM_BATCH_SIZE',
    );
    if (newValue) return parseInt(newValue, 10);
    const oldValue = this.configService.get<string>('MATCHING_BATCH_SIZE');
    if (oldValue) return parseInt(oldValue, 10);
    return 50;
  }

  /**
   * Maximum time (in ms) a task can be locked before being considered stale.
   * Stale tasks are released back to PENDING by the maintenance cron.
   *
   * WHY THIS VALUE:
   * - Must be longer than the longest possible matching run
   * - 11 minutes gives buffer for large batches + network issues
   * - Too short: Tasks released while still being processed (duplicates)
   * - Too long: Crashed workers block tasks for too long
   *
   * Default: 660000 (11 minutes)
   */
  get lockTtlMs(): number {
    const value = this.configService.get<string>('MATCHING_CRON_LOCK_TTL_MS');
    return value ? parseInt(value, 10) : 660000;
  }

  /**
   * Number of parallel workers per VM.
   * Each worker runs its own claim/process loop.
   *
   * WHY THIS VALUE:
   * - Matches typical CPU cores available
   * - Each worker holds a DB connection during processing
   * - Adjust based on your DB pool size and server resources
   *
   * Default: 4
   */
  get workerConcurrency(): number {
    const value = this.configService.get<string>('MATCHING_WORKER_CONCURRENCY');
    return value ? parseInt(value, 10) : 4;
  }

  /**
   * Maximum number of retry attempts for failed tasks.
   * After this many failures, task is marked FAILED permanently.
   * Default: 5
   */
  get maxAttempts(): number {
    const value = this.configService.get<string>('MATCHING_MAX_ATTEMPTS');
    return value ? parseInt(value, 10) : 5;
  }

  /**
   * Retry delays in milliseconds for exponential backoff.
   * Comma-separated list. Length should match maxAttempts.
   * Default: 30000,120000,600000,1800000,3600000 (30s, 2m, 10m, 30m, 1h)
   */
  get retryDelaysMs(): number[] {
    const value = this.configService.get<string>('MATCHING_RETRY_DELAYS_MS');
    if (!value) {
      return [30_000, 120_000, 600_000, 1_800_000, 3_600_000];
    }
    return value.split(',').map((s) => parseInt(s.trim(), 10));
  }

  /**
   * Get retry delay for a given attempt number (0-indexed)
   */
  getRetryDelayMs(attempt: number): number {
    const delays = this.retryDelaysMs;
    if (attempt >= delays.length) {
      return delays[delays.length - 1]; // Use last delay for overflow
    }
    return delays[attempt];
  }

  // ============================================================
  // SWEEP (CRON) CONFIGURATION
  // ============================================================

  /**
   * Maximum number of intents to enqueue per maintenance sweep.
   * This is the limit for the periodic "find eligible intents" query.
   *
   * WHY SEPARATE FROM taskClaimBatchSize:
   * - Sweep runs once per minute on ONE server
   * - Claim runs continuously on ALL workers across ALL VMs
   * - Different load patterns, different optimal values
   *
   * WHY THIS VALUE:
   * - Too low (20): May not keep up with new eligible intents
   * - Too high (1000): May overwhelm queue in burst
   * - Recommended: 100-300 for steady inflow
   *
   * Default: 200
   */
  get sweepLimit(): number {
    const value = this.configService.get<string>('MATCHING_SWEEP_LIMIT');
    return value ? parseInt(value, 10) : 200;
  }

  /**
   * Minimum interval between re-enqueuing the same intent (in minutes).
   * Prevents flooding the queue with tasks for the same intent.
   *
   * WHY THIS VALUE:
   * - Matching should run at most once every 5 minutes per intent
   * - Prevents abuse and excessive processing
   *
   * Default: 5
   */
  get enqueueIntervalMinutes(): number {
    const value = this.configService.get<string>(
      'MATCHING_ENQUEUE_INTERVAL_MINUTES',
    );
    return value ? parseInt(value, 5) : 5;
  }

  // ============================================================
  // ALGORITHM CONFIGURATION
  // ============================================================

  /**
   * Maximum number of candidate homes to evaluate per intent.
   * Limits memory usage and processing time for intents with many potential matches.
   *
   * WHY THIS VALUE:
   * - With 10k homes in DB, we don't want to compare against all of them
   * - 200 candidates is usually enough to find good matches
   * - Increase if users report missing matches
   *
   * Default: 200
   */
  get candidateLimit(): number {
    const value = this.configService.get<string>('MATCHING_CANDIDATE_LIMIT');
    return value ? parseInt(value, 10) : 200;
  }

  /**
   * Whether triangle (3-way) matching is enabled.
   * When false, only standard A<->B matches are created.
   *
   * WHY DISABLE:
   * - Triangle matching is more CPU-intensive
   * - Disable during high load or if not needed
   *
   * Default: true
   */
  get triangleEnabled(): boolean {
    const value = this.configService.get<string>('TRIANGLE_MATCHING_ENABLED');
    // Explicit 'false' disables, anything else (including undefined) enables
    return value !== 'false';
  }

  // ============================================================
  // MAINTENANCE CONFIGURATION
  // ============================================================

  /**
   * Timeout in milliseconds for each maintenance step.
   * If a step exceeds this time, it's considered hung and will be aborted.
   *
   * WHY THIS VALUE:
   * - On empty DB: steps should complete in < 100ms
   * - On large DB: steps may take 5-10 seconds
   * - 15 seconds is generous buffer
   * - Increase only if you see legitimate timeouts with large data
   *
   * Default: 15000 (15 seconds)
   */
  get maintenanceStepTimeoutMs(): number {
    const value = this.configService.get<string>(
      'MATCHING_MAINTENANCE_STEP_TIMEOUT_MS',
    );
    return value ? parseInt(value, 10) : 15000;
  }

  // ============================================================
  // REFUND CONFIGURATION
  // ============================================================

  /**
   * Number of days a user must wait after a refund before purchasing again.
   * Prevents abuse (buy, test, refund, repeat).
   * Default: 14
   */
  get refundCooldownDays(): number {
    const value = this.configService.get<string>('REFUND_REBUY_COOLDOWN_DAYS');
    return value ? parseInt(value, 10) : 14;
  }

  /**
   * Get refund cooldown in milliseconds
   */
  get refundCooldownMs(): number {
    return this.refundCooldownDays * 24 * 60 * 60 * 1000;
  }

  // ============================================================
  // CRON CONFIGURATION
  // ============================================================

  /**
   * Whether the matching cron is enabled.
   * Set to 'false' to disable all matching (useful for migrations).
   * Default: true
   */
  get cronEnabled(): boolean {
    const value = this.configService.get<string>('MATCHING_CRON_ENABLED');
    return value !== 'false';
  }

  // ============================================================
  // DEBUG CONFIGURATION
  // ============================================================

  /**
   * Enable verbose debug logging for matching algorithm.
   * WARNING: Very verbose, use only for troubleshooting.
   * Default: false
   */
  get debugEnabled(): boolean {
    return this.configService.get<string>('MATCHING_DEBUG') === 'true';
  }

  /**
   * Enable Prisma query logging.
   * Helps diagnose hung queries by showing the last query executed.
   * WARNING: Very verbose in production.
   * Default: false
   */
  get prismaLogQueries(): boolean {
    return this.configService.get<string>('PRISMA_LOG_QUERIES') === 'true';
  }

  /**
   * User ID A for trace logging (pair debugging).
   * When set with MATCHING_TRACE_USER_B, logs detailed info for this pair.
   */
  get traceUserA(): number | null {
    const value = this.configService.get<string>('MATCHING_TRACE_USER_A');
    return value ? parseInt(value, 10) : null;
  }

  /**
   * User ID B for trace logging (pair debugging).
   */
  get traceUserB(): number | null {
    const value = this.configService.get<string>('MATCHING_TRACE_USER_B');
    return value ? parseInt(value, 10) : null;
  }

  // ============================================================
  // INSTANCE IDENTIFICATION
  // ============================================================

  /**
   * Unique identifier for this VM/instance.
   * Used for worker identification and log correlation.
   * Default: hostname + process ID
   */
  get instanceId(): string {
    const custom = this.configService.get<string>('MATCHING_INSTANCE_ID');
    if (custom) return custom;

    // Generate from hostname and PID
    const hostname = require('os').hostname();
    const pid = process.pid;
    return `${hostname}-${pid}`;
  }

  // ============================================================
  // HELPER: LOG CONFIG SUMMARY
  // ============================================================

  /**
   * Get all config values as an object for logging.
   * Useful for debugging and startup logs.
   */
  getConfigSummary(): Record<string, string | number | boolean | null> {
    return {
      // Worker
      taskClaimBatchSize: this.taskClaimBatchSize,
      workerConcurrency: this.workerConcurrency,
      lockTtlMs: this.lockTtlMs,
      maxAttempts: this.maxAttempts,
      // Sweep
      sweepLimit: this.sweepLimit,
      enqueueIntervalMinutes: this.enqueueIntervalMinutes,
      // Algorithm
      candidateLimit: this.candidateLimit,
      triangleEnabled: this.triangleEnabled,
      // Maintenance
      maintenanceStepTimeoutMs: this.maintenanceStepTimeoutMs,
      // Refund
      refundCooldownDays: this.refundCooldownDays,
      // Debug
      debugEnabled: this.debugEnabled,
      prismaLogQueries: this.prismaLogQueries,
      // Instance
      instanceId: this.instanceId,
      cronEnabled: this.cronEnabled,
    };
  }
}
