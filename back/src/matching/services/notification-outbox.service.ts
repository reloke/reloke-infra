/**
 * notification-outbox.service.ts
 *
 * Transactional outbox pattern for reliable email notifications.
 * Decouples matching writes from email sending for crash-safety
 * and multi-VM idempotency.
 *
 * ARCHITECTURE:
 * - Matching transaction writes outbox records atomically
 * - Outbox sender claims records using SKIP LOCKED (multi-VM safe)
 * - Aggregates per user: "X nouveaux matchs" (1 email per user per run)
 * - Retry with exponential backoff on failures
 */

import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../../mail/mail.service';
import { MatchingConfigService } from '../config/matching.config';
import { MatchType, Prisma } from '@prisma/client';

interface OutboxRecord {
  id: number;
  runId: string;
  userId: number;
  intentId: number;
  matchCountDelta: number;
  matchType: MatchType;
  matchUids: string[] | null;
  attempts: number;
  maxAttempts: number;
}

interface AggregatedNotification {
  userId: number;
  email: string;
  userName: string;
  totalNewMatches: number;
  remainingCredits: number;
  matchUids: string[];
  outboxIds: number[];
}

@Injectable()
export class NotificationOutboxService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(NotificationOutboxService.name);
  private isRunning = false;
  private processingInterval: NodeJS.Timeout | null = null;
  private readonly BATCH_SIZE = 50;
  private readonly PROCESS_INTERVAL_MS = 10000; // 10 seconds

  // Retry backoff delays (in ms): 30s, 2m, 10m, 30m, 1h
  private readonly RETRY_DELAYS = [30000, 120000, 600000, 1800000, 3600000];

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
    private readonly config: MatchingConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.config.cronEnabled) {
      this.logger.warn('Outbox sender disabled (MATCHING_CRON_ENABLED=false)');
      return;
    }

    this.logger.log('Starting notification outbox sender');
    this.startProcessing();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopProcessing();
  }

  private startProcessing(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    this.processingInterval = setInterval(async () => {
      try {
        await this.processOutbox();
      } catch (error) {
        this.logger.error(`Outbox processing error: ${error.message}`);
      }
    }, this.PROCESS_INTERVAL_MS);

    this.logger.log(
      `Outbox sender started (interval: ${this.PROCESS_INTERVAL_MS}ms)`,
    );
  }

  private stopProcessing(): void {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }
    this.isRunning = false;
    this.logger.log('Outbox sender stopped');
  }

  /**
   * Process pending outbox records
   * Claims records with SKIP LOCKED for multi-VM safety
   */
  async processOutbox(): Promise<number> {
    const workerId = this.config.instanceId;
    let processed = 0;

    // Claim a batch of pending records
    const records = await this.claimBatch(workerId);

    if (records.length === 0) {
      return 0;
    }

    this.logger.debug(`[${workerId}] Claimed ${records.length} outbox records`);

    // Group by runId + userId for aggregation
    const aggregated = await this.aggregateByUser(records);

    // Send aggregated emails
    for (const notification of aggregated) {
      try {
        await this.sendAggregatedEmail(notification);
        await this.markProcessed(notification.outboxIds);
        processed += notification.outboxIds.length;
        this.logger.log(
          `[${workerId}] Sent email to ${notification.email}: ${notification.totalNewMatches} matches`,
        );
      } catch (error) {
        this.logger.error(
          `[${workerId}] Failed to send email to ${notification.email}: ${error.message}`,
        );
        await this.handleSendError(notification.outboxIds, error.message);
      }
    }

    return processed;
  }

  /**
   * Claim a batch of pending outbox records using SKIP LOCKED
   */
  private async claimBatch(workerId: string): Promise<OutboxRecord[]> {
    const records = await this.prisma.$queryRaw<OutboxRecord[]>`
      SELECT id, "runId", "userId", "intentId", "matchCountDelta", "matchType", "matchUids", attempts, "maxAttempts"
      FROM "MatchNotificationOutbox"
      WHERE "processedAt" IS NULL
        AND "availableAt" <= NOW()
        AND attempts < "maxAttempts"
      ORDER BY "createdAt" ASC
      LIMIT ${this.BATCH_SIZE}::bigint
      FOR UPDATE SKIP LOCKED
    `;

    return records;
  }

  /**
   * Aggregate outbox records by user
   * Multiple records for same user in same run = 1 email with sum of matches
   */
  private async aggregateByUser(
    records: OutboxRecord[],
  ): Promise<AggregatedNotification[]> {
    // Group by userId
    const userGroups = new Map<number, OutboxRecord[]>();
    for (const record of records) {
      if (!userGroups.has(record.userId)) {
        userGroups.set(record.userId, []);
      }
      userGroups.get(record.userId)!.push(record);
    }

    const notifications: AggregatedNotification[] = [];

    for (const [userId, userRecords] of userGroups) {
      // Fetch user info
      const intent = await this.prisma.intent.findFirst({
        where: { userId },
        select: {
          totalMatchesRemaining: true,
          user: {
            select: {
              mail: true,
              firstName: true,
              lastName: true,
            },
          },
        },
      });

      if (!intent?.user?.mail) {
        this.logger.warn(`User ${userId} has no email, skipping notification`);
        // Mark as processed to avoid retry loop
        await this.markProcessed(userRecords.map((r) => r.id));
        continue;
      }

      // Aggregate match counts and UIDs
      let totalNewMatches = 0;
      const matchUids: string[] = [];
      const outboxIds: number[] = [];

      for (const record of userRecords) {
        totalNewMatches += record.matchCountDelta;
        outboxIds.push(record.id);
        if (record.matchUids && Array.isArray(record.matchUids)) {
          matchUids.push(...record.matchUids);
        }
      }

      notifications.push({
        userId,
        email: intent.user.mail,
        userName:
          intent.user.firstName || intent.user.lastName || 'Utilisateur',
        totalNewMatches,
        remainingCredits: intent.totalMatchesRemaining,
        matchUids,
        outboxIds,
      });
    }

    return notifications;
  }

  /**
   * Send aggregated email notification
   */
  private async sendAggregatedEmail(
    notification: AggregatedNotification,
  ): Promise<void> {
    await this.mailService.sendMatchesFoundEmail(
      notification.email,
      notification.userName,
      notification.totalNewMatches,
      notification.remainingCredits,
    );
  }

  /**
   * Mark outbox records as processed
   */
  private async markProcessed(ids: number[]): Promise<void> {
    await this.prisma.matchNotificationOutbox.updateMany({
      where: { id: { in: ids } },
      data: {
        processedAt: new Date(),
        updatedAt: new Date(),
      },
    });
  }

  /**
   * Handle send error with retry scheduling
   */
  private async handleSendError(
    ids: number[],
    errorMessage: string,
  ): Promise<void> {
    // Get current attempts to calculate backoff
    const records = await this.prisma.matchNotificationOutbox.findMany({
      where: { id: { in: ids } },
      select: { id: true, attempts: true, maxAttempts: true },
    });

    for (const record of records) {
      const newAttempts = record.attempts + 1;

      if (newAttempts >= record.maxAttempts) {
        // Max attempts reached, mark as failed (leave processedAt null but stop retrying)
        await this.prisma.matchNotificationOutbox.update({
          where: { id: record.id },
          data: {
            attempts: newAttempts,
            lastError: `Max attempts reached: ${errorMessage}`,
            // Set availableAt far in future to stop retrying
            availableAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
            updatedAt: new Date(),
          },
        });
        this.logger.error(
          `Outbox ${record.id} permanently failed after ${newAttempts} attempts`,
        );
      } else {
        // Schedule retry with exponential backoff
        const delayMs =
          this.RETRY_DELAYS[
            Math.min(newAttempts - 1, this.RETRY_DELAYS.length - 1)
          ];
        const availableAt = new Date(Date.now() + delayMs);

        await this.prisma.matchNotificationOutbox.update({
          where: { id: record.id },
          data: {
            attempts: newAttempts,
            lastError: errorMessage,
            availableAt,
            updatedAt: new Date(),
          },
        });
        this.logger.warn(
          `Outbox ${record.id} scheduled for retry at ${availableAt.toISOString()}`,
        );
      }
    }
  }

  /**
   * Write outbox records for a STANDARD match (2 participants)
   * Called within the matching transaction
   *
   * @param tx - Prisma transaction client
   * @param runId - Matching run identifier
   * @param seekerData - Seeker intent/user data
   * @param targetData - Target intent/user data
   * @param matchUids - UIDs of the created matches (for deep links)
   */
  async writeStandardMatchOutbox(
    tx: Prisma.TransactionClient,
    runId: string,
    seekerData: { intentId: number; userId: number },
    targetData: { intentId: number; userId: number },
    matchUids: { seeker: string; target: string },
  ): Promise<void> {
    // Create outbox entry for seeker (1 new match for them)
    await tx.matchNotificationOutbox.upsert({
      where: {
        runId_userId_intentId: {
          runId,
          userId: seekerData.userId,
          intentId: seekerData.intentId,
        },
      },
      create: {
        runId,
        userId: seekerData.userId,
        intentId: seekerData.intentId,
        type: 'MATCHES_FOUND',
        matchCountDelta: 1,
        matchType: MatchType.STANDARD,
        matchUids: [matchUids.seeker],
      },
      update: {
        matchCountDelta: { increment: 1 },
        matchUids: undefined, // We'll handle UID aggregation differently if needed
        updatedAt: new Date(),
      },
    });

    // Create outbox entry for target (1 new match for them)
    await tx.matchNotificationOutbox.upsert({
      where: {
        runId_userId_intentId: {
          runId,
          userId: targetData.userId,
          intentId: targetData.intentId,
        },
      },
      create: {
        runId,
        userId: targetData.userId,
        intentId: targetData.intentId,
        type: 'MATCHES_FOUND',
        matchCountDelta: 1,
        matchType: MatchType.STANDARD,
        matchUids: [matchUids.target],
      },
      update: {
        matchCountDelta: { increment: 1 },
        matchUids: undefined,
        updatedAt: new Date(),
      },
    });
  }

  /**
   * Write outbox records for a TRIANGLE match (3 participants)
   * Called within the matching transaction
   *
   * @param tx - Prisma transaction client
   * @param runId - Matching run identifier
   * @param participants - Array of 3 participant data objects
   * @param matchUids - Array of 3 match UIDs (one per participant)
   */
  async writeTriangleMatchOutbox(
    tx: Prisma.TransactionClient,
    runId: string,
    participants: Array<{ intentId: number; userId: number }>,
    matchUids: string[],
  ): Promise<void> {
    for (let i = 0; i < participants.length; i++) {
      const participant = participants[i];
      const matchUid = matchUids[i];

      await tx.matchNotificationOutbox.upsert({
        where: {
          runId_userId_intentId: {
            runId,
            userId: participant.userId,
            intentId: participant.intentId,
          },
        },
        create: {
          runId,
          userId: participant.userId,
          intentId: participant.intentId,
          type: 'MATCHES_FOUND',
          matchCountDelta: 1, // 1 triangle = 1 match for each user
          matchType: MatchType.TRIANGLE,
          matchUids: matchUid ? [matchUid] : [],
        },
        update: {
          matchCountDelta: { increment: 1 },
          updatedAt: new Date(),
        },
      });
    }
  }

  /**
   * Flush outbox immediately after a matching run completes
   * Optional: call this after processTask to send emails faster
   */
  async flushForRun(runId: string): Promise<number> {
    const records = await this.prisma.matchNotificationOutbox.findMany({
      where: {
        runId,
        processedAt: null,
        availableAt: { lte: new Date() },
      },
      select: {
        id: true,
        runId: true,
        userId: true,
        intentId: true,
        matchCountDelta: true,
        matchType: true,
        matchUids: true,
        attempts: true,
        maxAttempts: true,
      },
    });

    if (records.length === 0) {
      return 0;
    }

    // Map to the expected type
    const outboxRecords: OutboxRecord[] = records.map((r) => ({
      ...r,
      matchUids: r.matchUids as string[] | null,
    }));

    const aggregated = await this.aggregateByUser(outboxRecords);
    let sent = 0;

    for (const notification of aggregated) {
      try {
        await this.sendAggregatedEmail(notification);
        await this.markProcessed(notification.outboxIds);
        sent++;
        this.logger.log(
          `[Flush] Sent email to ${notification.email}: ${notification.totalNewMatches} matches`,
        );
      } catch (error) {
        this.logger.error(
          `[Flush] Failed to send email to ${notification.email}: ${error.message}`,
        );
        await this.handleSendError(notification.outboxIds, error.message);
      }
    }

    return sent;
  }

  /**
   * Cleanup old processed outbox records (call from maintenance cron)
   */
  async cleanupOldRecords(olderThanDays: number = 30): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);

    const result = await this.prisma.matchNotificationOutbox.deleteMany({
      where: {
        processedAt: { not: null, lt: cutoff },
      },
    });

    if (result.count > 0) {
      this.logger.log(`Cleaned up ${result.count} old outbox records`);
    }

    return result.count;
  }
}
