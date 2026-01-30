import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SearchMaintenanceService } from '../search/search-maintenance.service';
import { S3Service } from '../home/services/s3.service';
import { DiditService } from '../didit/didit.service';
import * as crypto from 'crypto';

@Injectable()
export class CronService {
  private readonly logger = new Logger(CronService.name);
  private readonly archiveLockKey = BigInt('42004200');
  private readonly archiveBatchSize = 1000;
  private readonly archiveInactivityMonths = 6;

  constructor(
    private prisma: PrismaService,
    private readonly searchMaintenance: SearchMaintenanceService,
    private readonly s3Service: S3Service,
    private readonly diditService: DiditService,
  ) { }

  @Cron('* * * * *')
  async handleHardDeletion() {
    this.logger.log('Running User Anonymization (Hard Deletion) Cron Job...');

    const now = new Date();

    // 1. Find users whose deletion grace period is overdue
    const usersToAnonymize = await this.prisma.user.findMany({
      where: {
        deletionScheduledAt: {
          lt: now,
        },
        isDeletionFinalized: false,
      },
      include: {
        identityProofs: true,
        dossierFacileLink: true,
      },
    });

    if (usersToAnonymize.length === 0) {
      this.logger.log('No users to anonymize.');
      return;
    }

    for (const user of usersToAnonymize) {
      try {
        this.logger.log(`Anonymizing user ID: ${user.id} (${user.mail})`);
        const uuid = crypto.randomUUID();
        const diditSessionId = user.diditSessionId;

        // 2. Prepare S3 Cleanup
        const s3KeysToDelete: string[] = [];
        if (user.profilePicture && !user.profilePicture.startsWith('http')) {
          s3KeysToDelete.push(user.profilePicture);
        }
        user.identityProofs.forEach((proof) => {
          if (proof.url && !proof.url.startsWith('http')) {
            s3KeysToDelete.push(proof.url);
          }
        });
        if (
          user.dossierFacileLink?.dossierFacileUrl &&
          !user.dossierFacileLink.dossierFacileUrl.startsWith('http')
        ) {
          s3KeysToDelete.push(user.dossierFacileLink.dossierFacileUrl);
        }

        // 3. Transactional DB Anonymization
        await this.prisma.$transaction(async (tx) => {
          await tx.user.update({
            where: { id: user.id },
            data: {
              firstName: 'Utilisateur',
              lastName: 'Supprimé',
              mail: `deleted_${uuid}@anonymized.switchkey.com`,
              password: `ANONYMIZED_${uuid}`,
              deletedAt: new Date(),
              anonymizedAt: new Date(),
              deletionScheduledAt: null,
              deletionRequestedAt: user.deletionRequestedAt || new Date(),
              isActif: false,
              isLocked: true,
              paypaldId: null,
              stripeCustomerId: null,
              googleId: null,
              profilePicture: null,
              isDeletionFinalized: true,
              deletedReason: 'USER_REQUEST',
              status: 'DELETED',
              pushEnabled: false,
              marketingConsent: false,
              // Location fields anonymization (if they existed in User schema)
              // currently none in User model
            },
          });

          // Cleanup Relations
          await tx.identityProof.deleteMany({ where: { userId: user.id } });
        });

        // 4. External Cleanups (S3 & Didit) - Only if DB transaction succeeded

        // S3 Batch delete
        if (s3KeysToDelete.length > 0) {
          await this.s3Service.deleteFilesBatch(s3KeysToDelete);
        }

        // Didit deletion & final cleanup
        if (diditSessionId) {
          await this.diditService.deleteUserRecords(diditSessionId);

          // Final update to clear the ID as requested
          await this.prisma.user.update({
            where: { id: user.id },
            data: { diditSessionId: null },
          });
        }

        this.logger.log(`Successfully anonymized user ID: ${user.id}`);
      } catch (error) {
        this.logger.error(
          `Failed to anonymize user ${user.id}: ${error.message}`,
        );
      }
    }

    this.logger.log(
      `Processing complete. Anonymized ${usersToAnonymize.length} users.`,
    );
  }

  /**
   * Archive inactive matches (runs 1/11/21 at 03:15 Europe/Paris)
   */
  @Cron('15 3 1,11,21 * *', { timeZone: 'Europe/Paris' })
  async archiveInactiveMatches(): Promise<void> {
    const startedAt = Date.now();
    const thresholdDate = this.computeThresholdDate();
    let lockAcquired = false;
    const metrics = {
      batches: 0,
      usersScanned: 0,
      usersProcessed: 0,
      matchesArchived: 0,
      searchAdressesDeleted: 0,
      homeImgsDeleted: 0,
      s3KeysAttempted: 0,
    };
    const s3KeysToDelete: string[] = [];

    try {
      await this.prisma.$transaction(
        async (tx) => {
          const lockResult = await tx.$queryRaw<{ locked: boolean }[]>`
            SELECT pg_try_advisory_lock(${this.archiveLockKey}) AS locked
          `;
          const locked = lockResult?.[0]?.locked ?? false;
          if (!locked) {
            this.logger.warn(
              'Archive cron skipped: advisory lock not acquired.',
            );
            return;
          }

          lockAcquired = true;
          try {
            await this.processInactiveUserBatches(
              tx,
              thresholdDate,
              metrics,
              s3KeysToDelete,
            );
          } finally {
            await tx.$queryRaw`SELECT pg_advisory_unlock(${this.archiveLockKey})`;
          }
        },
        {
          maxWait: 5_000,
          timeout: 15 * 60 * 1_000,
        },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        this.logger.error(
          `Archive cron failed (Prisma error): ${error.message}`,
          error.stack,
        );
      } else {
        this.logger.error(
          `Archive cron failed: ${(error as Error).message}`,
          (error as Error).stack,
        );
      }
      return;
    }

    if (!lockAcquired) {
      return;
    }

    const durationMs = Date.now() - startedAt;
    if (s3KeysToDelete.length) {
      await this.searchMaintenance.deleteKeysSafe(s3KeysToDelete);
    }

    this.logger.log(
      `[ArchiveMatches] Done in ${durationMs}ms | batches=${metrics.batches} usersScanned=${metrics.usersScanned} usersProcessed=${metrics.usersProcessed} archivedMatches=${metrics.matchesArchived} searchAdressesDeleted=${metrics.searchAdressesDeleted} homeImagesDeleted=${metrics.homeImgsDeleted} s3Keys=${metrics.s3KeysAttempted} threshold=${thresholdDate.toISOString()}`,
    );
  }

  private computeThresholdDate(): Date {
    const threshold = new Date();
    threshold.setMonth(threshold.getMonth() - this.archiveInactivityMonths);
    return threshold;
  }

  private async processInactiveUserBatches(
    client: Prisma.TransactionClient,
    thresholdDate: Date,
    metrics: {
      batches: number;
      usersScanned: number;
      usersProcessed: number;
      matchesArchived: number;
      searchAdressesDeleted: number;
      homeImgsDeleted: number;
      s3KeysAttempted: number;
    },
    s3KeysToDelete: string[],
  ): Promise<void> {
    let lastSeenUserId = 0;
    const now = new Date();

    while (true) {
      const batch = await client.$queryRaw<{ id: number }[]>`
        SELECT "id"
        FROM "User"
        WHERE "dateLastConnection" < ${thresholdDate}
          AND "id" > ${lastSeenUserId}
        ORDER BY "id" ASC
        LIMIT ${this.archiveBatchSize}
      `;

      if (!batch.length) {
        break;
      }

      metrics.batches += 1;
      metrics.usersScanned += batch.length;

      const userIds = batch.map((row) => row.id);
      const { metrics: batchMetrics, s3Keys } =
        await this.searchMaintenance.cleanupUsersWithClient(
          client,
          userIds,
          now,
          { archiveMatches: true, stopIntents: true },
        );

      metrics.usersProcessed += batchMetrics.usersProcessed;
      metrics.matchesArchived += batchMetrics.matchesArchived;
      metrics.searchAdressesDeleted += batchMetrics.searchAdressesDeleted;
      metrics.homeImgsDeleted += batchMetrics.homeImgsDeleted;
      metrics.s3KeysAttempted += batchMetrics.s3KeysAttempted;
      s3KeysToDelete.push(...s3Keys);

      lastSeenUserId = Math.max(...userIds);
    }
  }
}
