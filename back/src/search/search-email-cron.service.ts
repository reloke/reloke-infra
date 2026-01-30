import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';

/**
 * Cooldown constants for anti-spam
 */
const NUDGE_EMAIL_COOLDOWN_HOURS = 48; // Email A: in-period but no credits
const EXPIRED_EMAIL_COOLDOWN_HOURS = 72; // Email B: search period expired
const BATCH_SIZE = 200; // Max emails per cron run

/**
 * Data structure for intent candidates from optimized query
 */
interface IntentEmailCandidate {
  id: number;
  userId: number;
  lastSearchNudgeEmailAt: Date | null;
  lastSearchExpiredEmailAt: Date | null;
  user: {
    mail: string;
    firstName: string;
  };
  search: {
    searchStartDate: Date | null;
    searchEndDate: Date | null;
  } | null;
}

@Injectable()
export class SearchEmailCronService {
  private readonly logger = new Logger(SearchEmailCronService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
  ) { }

  /**
   * Cron job running every 6 hours to send search-related emails
   * - Email A: Users in search period but with 0 credits
   * - Email B: Users whose search period has expired
   */
  @Cron(CronExpression.EVERY_6_HOURS)
  async handleSearchEmailCron(): Promise<void> {
    this.logger.log('[CRON] Starting search email cron job');

    const startTime = Date.now();
    let emailASent = 0;
    let emailBSent = 0;
    let emailASkipped = 0;
    let emailBSkipped = 0;

    try {
      // Process Email A: In-period but no credits
      const resultA = await this.processInPeriodNoCreditsEmails();
      emailASent = resultA.sent;
      emailASkipped = resultA.skipped;

      // Process Email B: Period expired
      const resultB = await this.processPeriodExpiredEmails();
      emailBSent = resultB.sent;
      emailBSkipped = resultB.skipped;
    } catch (error) {
      this.logger.error('[CRON] Error in search email cron:', error);
    }

    const duration = Date.now() - startTime;
    this.logger.log(
      `[CRON] Search email cron completed in ${duration}ms. ` +
      `Email A: ${emailASent} sent, ${emailASkipped} skipped. ` +
      `Email B: ${emailBSent} sent, ${emailBSkipped} skipped.`,
    );
  }

  /**
   * Email A: Users in search period but with no credits remaining
   * Condition:
   *   - now <= searchEndDate (still in period)
   *   - now >= searchStartDate (period has started)
   *   - isActivelySearching = true
   *   - totalMatchesRemaining = 0
   *   - lastSearchNudgeEmailAt is null OR older than NUDGE_EMAIL_COOLDOWN_HOURS
   */
  private async processInPeriodNoCreditsEmails(): Promise<{
    sent: number;
    skipped: number;
  }> {
    const now = new Date();
    const cooldownThreshold = new Date(
      now.getTime() + NUDGE_EMAIL_COOLDOWN_HOURS * 60 * 60 * 1000,
      // now.getTime()
    );
    console.log(now, 'now');
    console.log(cooldownThreshold, 'cooldownThreshold');

    console.log(now, "Now");

    const candidates = await this.prisma.intent.findMany({
      where: {
        isActivelySearching: true,
        totalMatchesRemaining: 0,

        search: {
          searchStartDate: { lte: now },
          searchEndDate: { gte: now },
        },

        AND: [
          // pas d’email “recharge” si l’utilisateur est en cooldown d’achat
          {
            OR: [
              { refundCooldownUntil: null },
              { refundCooldownUntil: { lte: now } },
            ],
          },

          // anti-spam email A
          {
            OR: [
              { lastSearchNudgeEmailAt: null },
              { lastSearchNudgeEmailAt: { lt: cooldownThreshold } },
            ],
          },
        ],
      },
      select: {
        id: true,
        userId: true,
        lastSearchNudgeEmailAt: true,
        lastSearchExpiredEmailAt: true,
        user: { select: { mail: true, firstName: true } },
        search: { select: { searchStartDate: true, searchEndDate: true } },
      },
      take: BATCH_SIZE,
    });

    this.logger.log(
      `[EMAIL A] Found ${candidates.length} candidates for in-period-no-credits email`,
    );

    let sent = 0;
    let skipped = 0;

    for (const intent of candidates) {
      const result = await this.sendInPeriodNoCreditsEmail(
        intent,
        now,
        cooldownThreshold,
      );
      if (result) {
        sent++;
      } else {
        skipped++;
      }
    }

    return { sent, skipped };
  }

  /**
   * Email B: Users whose search period has expired
   * Condition:
   *   - now > searchEndDate (period expired)
   *   - isActivelySearching = true
   *   - lastSearchExpiredEmailAt is null OR older than EXPIRED_EMAIL_COOLDOWN_HOURS
   */
  private async processPeriodExpiredEmails(): Promise<{
    sent: number;
    skipped: number;
  }> {
    const now = new Date();
    const cooldownThreshold = new Date(
      now.getTime() - EXPIRED_EMAIL_COOLDOWN_HOURS * 60 * 60 * 1000,
    );

    // Optimized batch query - fetch candidates
    const candidates = await this.prisma.intent.findMany({
      where: {
        isActivelySearching: true,
        search: {
          searchEndDate: { lt: now },
        },
        OR: [
          { lastSearchExpiredEmailAt: null },
          { lastSearchExpiredEmailAt: { lt: cooldownThreshold } },
        ],
      },
      select: {
        id: true,
        userId: true,
        lastSearchNudgeEmailAt: true,
        lastSearchExpiredEmailAt: true,
        user: { select: { mail: true, firstName: true } },
        search: { select: { searchStartDate: true, searchEndDate: true } },
      },
      take: BATCH_SIZE,
    });

    this.logger.log(
      `[EMAIL B] Found ${candidates.length} candidates for period-expired email`,
    );

    let sent = 0;
    let skipped = 0;

    for (const intent of candidates) {
      const result = await this.sendPeriodExpiredEmail(
        intent,
        now,
        cooldownThreshold,
      );
      if (result) {
        sent++;
      } else {
        skipped++;
      }
    }

    return { sent, skipped };
  }

  /**
   * Send in-period-no-credits email with atomic reservation (anti double-send)
   */
  private async sendInPeriodNoCreditsEmail(
    intent: IntentEmailCandidate,
    now: Date,
    cooldownThreshold: Date,
  ): Promise<boolean> {
    if (!intent.search?.searchStartDate || !intent.search?.searchEndDate) {
      this.logger.warn(
        `[EMAIL A] Intent ${intent.id} has no search dates, skipping`,
      );
      return false;
    }

    // Atomic reservation: update only if still eligible (prevents double-send in multi-worker)
    const reserved = await this.prisma.intent.updateMany({
      where: {
        id: intent.id,
        OR: [
          { lastSearchNudgeEmailAt: null },
          { lastSearchNudgeEmailAt: { lt: cooldownThreshold } },
        ],
      },
      data: { lastSearchNudgeEmailAt: now },
    });

    if (reserved.count === 0) {
      // Another worker already reserved this one
      this.logger.debug(
        `[EMAIL A] Intent ${intent.id} already reserved by another worker`,
      );
      return false;
    }

    try {
      await this.mailService.sendSearchInPeriodNoCreditsEmail(
        intent.user.mail,
        intent.user.firstName,
        intent.search.searchStartDate,
        intent.search.searchEndDate,
      );
      this.logger.log(
        `[EMAIL A] Sent to user ${intent.userId} (${intent.user.mail})`,
      );
      return true;
    } catch (error) {
      this.logger.error(
        `[EMAIL A] Failed to send to user ${intent.userId}:`,
        error,
      );
      // Revert the timestamp on failure so it can be retried
      await this.prisma.intent.update({
        where: { id: intent.id },
        data: { lastSearchNudgeEmailAt: intent.lastSearchNudgeEmailAt },
      });
      return false;
    }
  }

  /**
   * Send period-expired email with atomic reservation (anti double-send)
   */
  private async sendPeriodExpiredEmail(
    intent: IntentEmailCandidate,
    now: Date,
    cooldownThreshold: Date,
  ): Promise<boolean> {
    if (!intent.search?.searchStartDate || !intent.search?.searchEndDate) {
      this.logger.warn(
        `[EMAIL B] Intent ${intent.id} has no search dates, skipping`,
      );
      return false;
    }

    // Atomic reservation: update only if still eligible (prevents double-send in multi-worker)
    const reserved = await this.prisma.intent.updateMany({
      where: {
        id: intent.id,
        OR: [
          { lastSearchExpiredEmailAt: null },
          { lastSearchExpiredEmailAt: { lt: cooldownThreshold } },
        ],
      },
      data: { lastSearchExpiredEmailAt: now },
    });

    if (reserved.count === 0) {
      // Another worker already reserved this one
      this.logger.debug(
        `[EMAIL B] Intent ${intent.id} already reserved by another worker`,
      );
      return false;
    }

    try {
      await this.mailService.sendSearchPeriodExpiredEmail(
        intent.user.mail,
        intent.user.firstName,
        intent.search.searchStartDate,
        intent.search.searchEndDate,
      );
      this.logger.log(
        `[EMAIL B] Sent to user ${intent.userId} (${intent.user.mail})`,
      );
      return true;
    } catch (error) {
      this.logger.error(
        `[EMAIL B] Failed to send to user ${intent.userId}:`,
        error,
      );
      // Revert the timestamp on failure so it can be retried
      await this.prisma.intent.update({
        where: { id: intent.id },
        data: { lastSearchExpiredEmailAt: intent.lastSearchExpiredEmailAt },
      });
      return false;
    }
  }
}
