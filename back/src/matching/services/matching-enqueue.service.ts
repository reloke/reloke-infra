/**
 * matching-enqueue.service.ts
 *
 * Service responsible for enqueuing intents for matching processing.
 *
 * ============================================================
 * ENQUEUE TRIGGERS
 * ============================================================
 *
 * 1. Event-driven: Payment success, Home/Search updates
 *    - Called via enqueueIntent(intentId)
 *    - Fast response to user actions
 *
 * 2. Periodic sweep: Cron maintenance finds eligible intents
 *    - Called via sweepEligibleIntents()
 *    - Catches any missed events and handles edge cases
 *
 * WHY THIS APPROACH:
 * - Event-driven ensures fast response to user actions
 * - Periodic sweep catches any missed events and handles edge cases
 * - ON CONFLICT DO NOTHING prevents duplicate tasks
 *
 * The actual matching work is done by MatchingWorkerService.
 *
 * ============================================================
 * CONFIGURATION
 * ============================================================
 *
 * MATCHING_SWEEP_LIMIT (default: 200)
 *   - Max intents to enqueue per sweep
 *   - Separate from MATCHING_CANDIDATE_LIMIT (algo) and MATCHING_TASK_CLAIM_BATCH_SIZE (worker)
 *
 * MATCHING_ENQUEUE_INTERVAL_MINUTES (default: 10)
 *   - Minimum time before re-enqueuing the same intent
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  MatchingConfigService,
  MatchingTaskStatus,
  MatchingTaskType,
} from '../config/matching.config';

export interface EnqueueResult {
  enqueued: number;
  skipped: number;
  errors: number;
}

@Injectable()
export class MatchingEnqueueService {
  private readonly logger = new Logger(MatchingEnqueueService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: MatchingConfigService,
  ) {}

  /**
   * Enqueue a single intent for matching.
   * Called after payment success or profile updates.
   *
   * IDEMPOTENT BEHAVIOR:
   * - If task exists with PENDING/RUNNING status -> skip (already queued)
   * - If task exists with DONE/FAILED status -> reset to PENDING (re-enqueue)
   * - If no task exists -> create new PENDING task
   *
   * This approach is safe for multi-VM environments and avoids
   * the delete-then-create race condition.
   *
   * @param intentId - The intent to enqueue
   * @returns true if enqueued or re-enqueued, false if already queued or not eligible
   */
  async enqueueIntent(intentId: number): Promise<boolean> {
    try {
      // First, verify the intent exists and is eligible
      const intent = await this.prisma.intent.findUnique({
        where: { id: intentId },
      });

      if (!intent) {
        this.logger.warn(`[Enqueue] Intent ${intentId} not found`);
        return false;
      }

      // Skip if not eligible for matching
      if (!intent.isInFlow || intent.totalMatchesRemaining <= 0) {
        this.logger.debug(
          `[Enqueue] Intent ${intentId} not eligible: isInFlow=${intent.isInFlow}, credits=${intent.totalMatchesRemaining}`,
        );
        return false;
      }

      // Skip if currently being processed
      if (
        intent.matchingProcessingUntil &&
        intent.matchingProcessingUntil > new Date()
      ) {
        this.logger.debug(
          `[Enqueue] Intent ${intentId} currently being processed until ${intent.matchingProcessingUntil.toISOString()}`,
        );
        return false;
      }

      // Check if there's already a task for this intent+type
      const existingTask = await this.prisma.matchingTask.findUnique({
        where: {
          intentId_type: {
            intentId,
            type: MatchingTaskType.MATCHING,
          },
        },
        select: { id: true, status: true },
      });

      if (existingTask) {
        // If PENDING or RUNNING -> skip
        if (
          existingTask.status === MatchingTaskStatus.PENDING ||
          existingTask.status === MatchingTaskStatus.RUNNING
        ) {
          this.logger.debug(
            `[Enqueue] Intent ${intentId} already has ${existingTask.status} task`,
          );
          return false;
        }

        // If DONE or FAILED -> reset to PENDING (re-enqueue)
        await this.prisma.matchingTask.update({
          where: { id: existingTask.id },
          data: {
            status: MatchingTaskStatus.PENDING,
            attempts: 0,
            lastError: null,
            availableAt: new Date(),
            lockedAt: null,
            lockedBy: null,
            runId: null,
          },
        });

        // Update lastMatchingEnqueuedAt
        await this.prisma.intent.update({
          where: { id: intentId },
          data: { lastMatchingEnqueuedAt: new Date() },
        });

        this.logger.log(
          `[Enqueue] Re-enqueued intent ${intentId} (was ${existingTask.status})`,
        );
        return true;
      }

      // No task exists -> create new one
      await this.prisma.matchingTask.create({
        data: {
          intentId,
          type: MatchingTaskType.MATCHING,
          status: MatchingTaskStatus.PENDING,
          availableAt: new Date(),
          maxAttempts: this.config.maxAttempts,
        },
      });

      // Update lastMatchingEnqueuedAt to prevent rapid re-enqueue
      await this.prisma.intent.update({
        where: { id: intentId },
        data: { lastMatchingEnqueuedAt: new Date() },
      });

      this.logger.log(`[Enqueue] Created matching task for intent ${intentId}`);
      return true;
    } catch (error) {
      // Handle unique constraint violation (race condition - task was just created)
      if (error.code === 'P2002') {
        this.logger.debug(
          `[Enqueue] Intent ${intentId} task already exists (race condition)`,
        );
        return false;
      }

      this.logger.error(
        `[Enqueue] Failed to enqueue intent ${intentId}: ${error.message}`,
      );
      return false;
    }
  }

  /**
   * Enqueue multiple intents in a batch.
   * Used for bulk operations (e.g., after a system update).
   *
   * @param intentIds - Array of intent IDs to enqueue
   * @returns Summary of enqueue results
   */
  async enqueueIntents(intentIds: number[]): Promise<EnqueueResult> {
    const result: EnqueueResult = { enqueued: 0, skipped: 0, errors: 0 };

    for (const intentId of intentIds) {
      try {
        const success = await this.enqueueIntent(intentId);
        if (success) {
          result.enqueued++;
        } else {
          result.skipped++;
        }
      } catch (error) {
        result.errors++;
        this.logger.error(
          `[Enqueue] Error enqueuing intent ${intentId}: ${error.message}`,
        );
      }
    }

    return result;
  }

  /**
   * Sweep for intents that need re-matching.
   * Called by the maintenance cron every minute.
   *
   * ============================================================
   * ELIGIBILITY CRITERIA
   * ============================================================
   *
   * 1. isInFlow = true (has active subscription)
   * 2. totalMatchesRemaining > 0 (has credits)
   * 3. Not currently being processed (matchingProcessingUntil null or past)
   * 4. Not recently enqueued (lastMatchingEnqueuedAt older than interval)
   *
   * WHY PERIODIC SWEEP:
   * - Catches intents missed by event-driven enqueue
   * - Handles system restarts/failures
   * - Ensures eventually-consistent matching for all eligible users
   *
   * PERFORMANCE NOTE:
   * - Uses MATCHING_SWEEP_LIMIT (not MATCHING_CANDIDATE_LIMIT)
   * - On empty DB, this query returns immediately with 0 results
   *
   * @returns Number of intents enqueued
   */
  async sweepEligibleIntents(): Promise<number> {
    const enqueueIntervalMs = this.config.enqueueIntervalMinutes * 60 * 1000;
    const enqueueThreshold = new Date(Date.now() - enqueueIntervalMs);

    // Use sweepLimit (NOT candidateLimit - that's for the algorithm)
    const limit = this.config.sweepLimit;

    // Find eligible intents that haven't been enqueued recently
    // This is a lightweight query - we only fetch IDs
    const eligibleIntents = await this.prisma.intent.findMany({
      where: {
        isInFlow: true,
        totalMatchesRemaining: { gt: 0 },
        AND: [
          {
            OR: [
              { matchingProcessingUntil: null },
              { matchingProcessingUntil: { lt: new Date() } },
            ],
          },
          {
            OR: [
              { lastMatchingEnqueuedAt: null },
              { lastMatchingEnqueuedAt: { lt: enqueueThreshold } },
            ],
          },
        ],
      },
      select: { id: true },
      take: limit,
      orderBy: { lastMatchingProcessedAt: 'asc' }, // Prioritize oldest
    });

    // Empty DB case: return immediately
    if (eligibleIntents.length === 0) {
      return 0;
    }

    this.logger.debug(
      `[Sweep] Found ${eligibleIntents.length} eligible intents for enqueue (limit=${limit})`,
    );

    const result = await this.enqueueIntents(eligibleIntents.map((i) => i.id));

    if (result.enqueued > 0 || result.errors > 0) {
      this.logger.log(
        `[Sweep] Enqueue result: ${result.enqueued} enqueued, ${result.skipped} skipped, ${result.errors} errors`,
      );
    }

    return result.enqueued;
  }

  /**
   * Get queue statistics for monitoring.
   *
   * @returns Queue status summary
   */
  async getQueueStats(): Promise<{
    pending: number;
    running: number;
    done: number;
    failed: number;
    avgWaitTimeMs: number | null;
  }> {
    const [pending, running, done, failed] = await Promise.all([
      this.prisma.matchingTask.count({
        where: { status: MatchingTaskStatus.PENDING },
      }),
      this.prisma.matchingTask.count({
        where: { status: MatchingTaskStatus.RUNNING },
      }),
      this.prisma.matchingTask.count({
        where: { status: MatchingTaskStatus.DONE },
      }),
      this.prisma.matchingTask.count({
        where: { status: MatchingTaskStatus.FAILED },
      }),
    ]);

    // Calculate average wait time for pending tasks
    let avgWaitTimeMs: number | null = null;
    if (pending > 0) {
      const result = await this.prisma.$queryRaw<[{ avg_wait: number }]>`
        SELECT EXTRACT(EPOCH FROM (NOW() - "createdAt")) * 1000 AS avg_wait
        FROM "MatchingTask"
        WHERE status = 'PENDING'
      `;
      avgWaitTimeMs = result[0]?.avg_wait ?? null;
    }

    return { pending, running, done, failed, avgWaitTimeMs };
  }
}
