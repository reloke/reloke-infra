import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Cron, CronExpression } from '@nestjs/schedule';
import { S3Service } from '../../home/services/s3.service';
import { MailService } from '../../mail/mail.service';
import { ConfigService } from '@nestjs/config';
import { MatchingPaymentsService } from '../../matching/services/matching-payments.service';

@Injectable()
export class DataLifecycleService {
  private readonly logger = new Logger(DataLifecycleService.name);

  constructor(
    private prisma: PrismaService,
    private s3Service: S3Service,
    private mailService: MailService,
    private configService: ConfigService,
    private matchingPaymentsService: MatchingPaymentsService,
  ) { }

  /**
   * Updates the user's lastActivityAt timestamp.
   * Rate limited to once every 10 minutes to avoid DB spam.
   */
  async touchUserActivity(userId: number): Promise<void> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { lastActivityAt: true },
      });

      if (!user) return;

      const now = new Date();
      const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000);

      // Only update if last activity was more than 10 minutes ago
      if (!user.lastActivityAt || user.lastActivityAt < tenMinutesAgo) {
        await this.prisma.user.update({
          where: { id: userId },
          data: { lastActivityAt: now },
        });
      }
    } catch (e) {
      // Non-blocking error
      this.logger.warn(
        `Failed to touch user activity for ${userId}: ${e.message}`,
      );
    }
  }

  /**
   * Schedule account deletion (User request)
   * Grace period: 30 days
   * Includes: refund, session invalidation, intents deactivation, email notification
   */
  async scheduleAccountDeletion(userId: number): Promise<{
    scheduledAt: Date;
    isLegalHold: boolean;
    refundApplied: boolean;
    refundAmount?: number;
    matchesRefunded?: number;
  }> {
    // 1. Verify user exists
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        intents: {
          where: { totalMatchesRemaining: { gt: 0 } },
          select: { id: true, totalMatchesRemaining: true, isInFlow: true },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.deletionScheduledAt) {
      throw new ConflictException('Deletion already scheduled');
    }

    // 2. Check for open legal holds
    const openHolds = await this.prisma.legalCase.count({
      where: {
        userId,
        OR: [{ status: 'OPEN' }, { holdUntil: { gt: new Date() } }],
      },
    });

    const isLegalHold = openHolds > 0;

    // 3. Automated refund if user has remaining credits
    let refundResult: {
      success: boolean;
      matchesRefunded: number;
      refundedAmount: number;
    } | null = null;
    const hasCredits = user.intents.some((i) => i.totalMatchesRemaining > 0);

    if (hasCredits) {
      try {
        refundResult =
          await this.matchingPaymentsService.requestRefund(userId);
        this.logger.log(
          `Auto-refund applied for user ${userId}: ${refundResult.refundedAmount}€`,
        );
      } catch (err) {
        this.logger.error(
          `Auto-refund failed for user ${userId}: ${err.message}`,
        );
        // Continue deletion process even if refund fails
      }
    }

    // 4. Calculate deletion date (J+30)
    const deletionDate = new Date();
    deletionDate.setDate(deletionDate.getDate() + 30);

    // 5. Update user status
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        status: isLegalHold ? 'DISABLED' : 'PENDING_DELETION',
        deletionScheduledAt: deletionDate,
        deletionRequestedAt: new Date(),
        deletedReason: 'USER_REQUEST',
        isActif: false, // Deactivate profile immediately
        marketingConsent: false,
        pushEnabled: false,
        tokenVersion: { increment: 1 }, // Invalidate all sessions
      },
    });

    // 6. Deactivate all intents (remove from matching flow)
    await this.prisma.intent.updateMany({
      where: { userId },
      data: {
        isInFlow: false,
        isActivelySearching: false,
      },
    });

    // 7. Send confirmation email
    const isInFlow = user.intents.some((i) => i.isInFlow);
    await this.mailService.sendDeletionRequestEmail(
      user.mail,
      user.firstName || 'Utilisateur',
      deletionDate,
      isInFlow,
      refundResult?.success || false,
      refundResult?.matchesRefunded || 0,
      refundResult?.refundedAmount || 0,
    );

    this.logger.log(
      `Deletion scheduled for user ${userId} on ${deletionDate.toISOString()}` +
      (isLegalHold ? ' (LEGAL HOLD active)' : '') +
      (refundResult?.success
        ? ` - Refund: ${refundResult.refundedAmount}€`
        : ''),
    );

    return {
      scheduledAt: deletionDate,
      isLegalHold,
      refundApplied: refundResult?.success || false,
      refundAmount: refundResult?.refundedAmount,
      matchesRefunded: refundResult?.matchesRefunded,
    };
  }

  /**
   * Cancel account deletion (User request)
   */
  async cancelAccountDeletion(userId: number): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.deletionScheduledAt) {
      throw new Error('No deletion scheduled');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        status: 'ACTIVE',
        deletionScheduledAt: null,
        deletedReason: null,
        isActif: true,
        deletionRequestedAt: null,
      },
    });

    this.logger.log(`Cancelled deletion for user ${userId}`);
  }

  /**
   * CRON: Schedule deletion for inactive users (> 2 years)
   */
  @Cron(CronExpression.EVERY_WEEK)
  async scheduleInactiveUsersDeletion() {
    this.logger.log('Starting check for inactive users...');

    const twoYearsAgo = new Date();
    twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);

    const inactiveUsers = await this.prisma.user.findMany({
      where: {
        lastActivityAt: { lt: twoYearsAgo },
        deletedAt: null,
        deletionScheduledAt: null,
        status: { notIn: ['ANONYMIZED', 'PENDING_DELETION'] },
      },
      take: 100, // Batch processing
    });

    for (const user of inactiveUsers) {
      // Schedule deletion in 30 days (grace period after inactivity detection)
      const deletionDate = new Date();
      deletionDate.setDate(deletionDate.getDate() + 30);

      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          deletionScheduledAt: deletionDate,
          deletedReason: 'INACTIVITY',
          // We keep status as is or set to PENDING_DELETION?
          // If we want to warn them, maybe keep active but schedule it.
          // For now, let's mark as pending deletion.
          status: 'PENDING_DELETION',
        },
      });

      this.logger.log(`Scheduled inactivity deletion for user ${user.id}`);
      // TODO: Send warning email
    }
  }

  /**
   * CRON: Finalize scheduled deletions
   * Idempotent execution
   */
  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  // @Cron(CronExpression.EVERY_SECONDS)
  async finalizeUserDeletions() {
    this.logger.log('Starting finalization of scheduled deletions...');

    const now = new Date();
    const usersToDelete = await this.prisma.user.findMany({
      where: {
        deletionScheduledAt: { lte: now },
        deletedAt: null,
        isDeletionFinalized: false,
      },
      take: 50,
    });

    for (const user of usersToDelete) {
      await this.processUserDeletion(user.id);
    }
  }

  /**
   * Process a single user deletion idempotently
   */
  private async processUserDeletion(userId: number) {
    this.logger.log(`Processing deletion for user ${userId}`);

    // Step 0: Check Legal Hold
    const hasOpenHold = await this.prisma.legalCase.count({
      where: {
        userId,
        OR: [{ status: 'OPEN' }, { holdUntil: { gt: new Date() } }],
      },
    });

    if (hasOpenHold > 0) {
      this.logger.warn(
        `User ${userId} has active Legal Hold. Skipping final deletion.`,
      );
      // Ensure access is cut
      await this.prisma.user.update({
        where: { id: userId },
        data: { status: 'DISABLED', deletedReason: 'LEGAL_HOLD' },
      });
      return;
    }

    try {
      // Collect S3 keys to delete BEFORE DB deletion (to access them)
      // Home Images
      const homeImages = await this.prisma.homeImg.findMany({
        where: { userId },
        select: { url: true },
      });

      // Identity Proofs
      const identityProofs = await this.prisma.identityProof.findMany({
        where: { userId },
        select: { url: true },
      });

      // Message Images (where user is sender)
      // Note: we might want to keep images if message is part of a report for legal reasons?
      // But we just checked legal hold. If no legal hold, we delete.
      const messageImages = await this.prisma.messageImg.findMany({
        where: { message: { senderId: userId } },
        select: { url: true },
      });

      // ✅ FIX P1.3: HelpRequest Attachments (S3 files)
      const helpAttachments = await this.prisma.helpRequestAttachment.findMany(
        {
          where: {
            helpRequest: { userId },
          },
          select: { url: true },
        },
      );

      // ✅ FIX P1.3: User Profile Picture (if hosted on S3)
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { profilePicture: true },
      });

      const profilePictureKeys: string[] = [];
      if (user?.profilePicture) {
        // Check if it's an S3 URL (not a Gravatar or external URL)
        const bucketName = this.configService.get<string>(
          'AWS_S3_BUCKET_NAME',
        );
        if (
          user.profilePicture.includes('s3') ||
          (bucketName && user.profilePicture.includes(bucketName))
        ) {
          profilePictureKeys.push(user.profilePicture);
        }
      }

      const s3KeysToDelete = [
        ...homeImages.map((i) => i.url),
        ...identityProofs.map((i) => i.url),
        ...messageImages.map((i) => i.url),
        ...helpAttachments.map((a) => a.url),
        ...profilePictureKeys,
      ];

      this.logger.log(
        `Collected ${s3KeysToDelete.length} S3 keys to delete for user ${userId} ` +
        `(HomeImg: ${homeImages.length}, IdentityProof: ${identityProofs.length}, ` +
        `MessageImg: ${messageImages.length}, HelpAttachment: ${helpAttachments.length}, ` +
        `ProfilePic: ${profilePictureKeys.length})`,
      );

      // Step 2: Anonymize User (preserve for payments FK)
      // We perform this in a transaction if possible, or sequential steps

      // Anonymization data
      const anonymizedEmail = `deleted+${userId}@reloke.invalid`;
      const anonymizedName = 'Deleted User';

      await this.prisma.$transaction(async (tx) => {
        // Delete operational data
        await tx.home.deleteMany({ where: { userId } }); // cascades to HomeImg
        await tx.search.deleteMany({ where: { userId } }); // cascades

        // ✅ FIX P1.2: Check if Intents have Payments before deletion
        // Payment has FK to Intent → Cannot delete Intent if Payments exist
        // Must preserve Intent for 10-year payment retention requirement
        const userIntents = await tx.intent.findMany({
          where: { userId },
          select: { id: true },
        });

        const intentIds = userIntents.map((i) => i.id);

        if (intentIds.length > 0) {
          // Count payments linked to these intents
          const paymentsCount = await tx.payment.count({
            where: { intentId: { in: intentIds } },
          });

          if (paymentsCount === 0) {
            // Safe to delete: no payments reference these intents
            await tx.intent.deleteMany({ where: { userId } });
            this.logger.log(
              `Deleted ${intentIds.length} intents for user ${userId} (no payments)`,
            );
          } else {
            // Payments exist → KEEP Intent for accounting compliance (10 years)
            // Optionally: anonymize non-essential Intent fields if needed
            this.logger.warn(
              `Kept ${intentIds.length} intents for user ${userId} (linked to ${paymentsCount} payments - 10-year retention)`,
            );
          }
        }

        // ✅ FIX P1.3: Delete HelpRequests (cascades to HelpRequestAttachment)
        // HelpRequestAttachment files already collected in S3 keys above
        await tx.helpRequest.deleteMany({ where: { userId } });

        // Chat/Messages:
        // Handle messages: Redact if reported, Delete otherwise
        const messages = await tx.message.findMany({
          where: { senderId: userId },
          select: { id: true },
        });

        for (const msg of messages) {
          // Check if attached to a report or legal case
          // Note: In an ideal world we check LegalCase relations too, but Report is the main indicator in legacy
          const reportCount = await tx.report.count({
            where: { messageId: msg.id },
          });

          if (reportCount > 0) {
            await tx.message.update({
              where: { id: msg.id },
              data: {
                content: '[Message supprimé - RGPD]',
                isDeleted: true,
                deletedAt: new Date(),
                redactedAt: new Date(),
                redactionReason: 'USER_DELETION_LINKED_TO_REPORT',
                fileUrl: null, // Remove attachment ref
              },
            });
          } else {
            await tx.message.delete({ where: { id: msg.id } });
          }
        }

        // Anonymize User
        await tx.user.update({
          where: { id: userId },
          data: {
            firstName: anonymizedName,
            lastName: anonymizedName,
            mail: anonymizedEmail,
            password: 'DELETED', // Random hash or constant
            profilePicture: null,
            googleId: null,
            paypaldId: null,
            stripeCustomerId: null,
            isActif: false,
            status: 'ANONYMIZED',
            deletedAt: new Date(),
            anonymizedAt: new Date(),
            isDeletionFinalized: true,
            // Clear tokens
            resetPasswordToken: null,
            dossierFacileUrl: null,
            diditSessionId: null,
          },
        });

        // Delete UserMetadata explicitly (Safer than nested write if it doesn't exist)
        await tx.userMetadata.deleteMany({ where: { userId } });
        await tx.pushSubscription.deleteMany({ where: { userId } });
        await tx.notification.deleteMany({ where: { userId } });
        await tx.connectionLog.deleteMany({ where: { userId } });
      });

      // Step 3: Purge S3 (After DB success)
      if (s3KeysToDelete.length > 0) {
        // We assume deleteFiles ignores missing files
        // S3Service needs a bulk delete or loop
        for (const key of s3KeysToDelete) {
          // Assuming key is the object key
          try {
            await this.s3Service.deleteFile(key);
          } catch (err) {
            // ignore s3 errors
          }
        }
      }

      this.logger.log(
        `Successfully finalized deletion/anonymization for user ${userId}`,
      );
    } catch (e) {
      this.logger.error(
        `Failed to process deletion for user ${userId}: ${e.message}`,
        e.stack,
      );
    }
  }

  /**
   * CRON: Purge old logs (> 12 months)
   */
  @Cron('0 0 1 * *')
  async purgeOldLogs() {
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setFullYear(twelveMonthsAgo.getFullYear() - 1);

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const threeYearsAgo = new Date();
    threeYearsAgo.setFullYear(threeYearsAgo.getFullYear() - 3);

    // Purge ConnectionLogs (12 months)
    const { count: connCount } = await this.prisma.connectionLog.deleteMany({
      where: { loginDate: { lt: twelveMonthsAgo } },
    });

    // Purge Notifications (12 months)
    const { count: notifCount } = await this.prisma.notification.deleteMany({
      where: { createdAt: { lt: twelveMonthsAgo } },
    });

    // ✅ P1.5: Purge NotificationLog (12 months)
    const { count: notifLogCount } =
      await this.prisma.notificationLog.deleteMany({
        where: { createdAt: { lt: twelveMonthsAgo } },
      });

    // ✅ P1.5: Purge MatchNotificationOutbox (processed > 30 days)
    const { count: matchOutboxCount } =
      await this.prisma.matchNotificationOutbox.deleteMany({
        where: {
          processedAt: {
            not: null,
            lt: thirtyDaysAgo,
          },
        },
      });

    // Purge AuditLogs (3 years)
    const { count: auditCount } = await this.prisma.auditLog.deleteMany({
      where: { createdAt: { lt: threeYearsAgo } },
    });

    this.logger.log(
      `Purged logs: ${connCount} connection logs, ${notifCount} notifications, ` +
      `${notifLogCount} notificationLogs, ${matchOutboxCount} matchNotificationOutbox, ` +
      `${auditCount} audit logs.`,
    );

    return {
      connectionLogs: connCount,
      notifications: notifCount,
      notificationLogs: notifLogCount,
      matchNotificationOutbox: matchOutboxCount,
      auditLogs: auditCount,
    };
  }
}
