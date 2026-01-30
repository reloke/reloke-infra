import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { S3Service } from '../home/services/s3.service';

export interface CleanupMetrics {
  matchesArchived: number;
  searchAdressesDeleted: number;
  homeImgsDeleted: number;
  usersProcessed: number;
  s3KeysAttempted: number;
}

@Injectable()
export class SearchMaintenanceService {
  private readonly logger = new Logger(SearchMaintenanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3Service: S3Service,
  ) {}

  /**
   * Public orchestrator for a list of users (starts its own transaction).
   * Returns cleanup metrics and performs S3 deletions outside the transaction.
   */
  async stopAndCleanupUsers(
    userIds: number[],
    options?: { archiveMatches?: boolean; stopIntents?: boolean; now?: Date },
  ): Promise<CleanupMetrics> {
    if (!userIds.length) {
      return {
        matchesArchived: 0,
        searchAdressesDeleted: 0,
        homeImgsDeleted: 0,
        usersProcessed: 0,
        s3KeysAttempted: 0,
      };
    }

    const now = options?.now ?? new Date();

    const { metrics, s3Keys } = await this.prisma.$transaction(async (tx) => {
      return this.cleanupUsersWithClient(tx, userIds, now, options);
    });

    await this.deleteKeysSafe(s3Keys);

    return metrics;
  }

  /**
   * Core logic usable inside an existing transaction (e.g., cron with advisory lock).
   * Returns metrics and the list of S3 keys to delete after the transaction.
   */
  async cleanupUsersWithClient(
    client: Prisma.TransactionClient,
    userIds: number[],
    now: Date,
    options?: { archiveMatches?: boolean; stopIntents?: boolean },
  ): Promise<{ metrics: CleanupMetrics; s3Keys: string[] }> {
    if (!userIds.length) {
      return {
        metrics: {
          matchesArchived: 0,
          searchAdressesDeleted: 0,
          homeImgsDeleted: 0,
          usersProcessed: 0,
          s3KeysAttempted: 0,
        },
        s3Keys: [],
      };
    }

    const userIdArray = Prisma.sql`ARRAY[${Prisma.join(userIds)}]::int[]`;
    const metrics: CleanupMetrics = {
      matchesArchived: 0,
      searchAdressesDeleted: 0,
      homeImgsDeleted: 0,
      usersProcessed: userIds.length,
      s3KeysAttempted: 0,
    };

    if (options?.archiveMatches !== false) {
      const updated = await client.$executeRaw`
        WITH user_intents AS (
          SELECT id FROM "Intent" WHERE "userId" = ANY(${userIdArray})
        )
        UPDATE "Match"
        SET "statusBeforeArchive" = "status",
            "archivedAt" = NOW(),
            "status" = 'ARCHIVED'
        WHERE "status" <> 'ARCHIVED'
          AND (
            "seekerIntentId" IN (SELECT id FROM user_intents)
            OR "targetIntentId" IN (SELECT id FROM user_intents)
          )
      `;
      metrics.matchesArchived += Number(updated) || 0;
    }

    // Collect S3 keys before deleting rows
    const s3Keys: string[] = [];
    const imageBatchSize = 500;
    let lastImageId = 0;
    while (true) {
      const images = await client.homeImg.findMany({
        where: { userId: { in: userIds }, id: { gt: lastImageId } },
        select: { id: true, url: true },
        orderBy: { id: 'asc' },
        take: imageBatchSize,
      });

      if (!images.length) {
        break;
      }

      s3Keys.push(...images.map((img) => img.url));
      lastImageId = images[images.length - 1].id;

      if (images.length < imageBatchSize) {
        break;
      }
    }
    metrics.s3KeysAttempted = s3Keys.length;

    // Delete associations
    const deletedSearchAdresses = await client.$executeRaw`
      DELETE FROM "SearchAdress"
      WHERE "searchId" IN (SELECT id FROM "Search" WHERE "userId" = ANY(${userIdArray}))
    `;
    metrics.searchAdressesDeleted += Number(deletedSearchAdresses) || 0;

    const deletedHomeImgs = await client.homeImg.deleteMany({
      where: { userId: { in: userIds } },
    });
    metrics.homeImgsDeleted += deletedHomeImgs.count;

    // Reset Search
    await client.search.updateMany({
      where: { userId: { in: userIds } },
      data: {
        minRent: null,
        maxRent: null,
        minRoomSurface: null,
        maxRoomSurface: null,
        minRoomNb: null,
        maxRoomNb: null,
        homeType: Prisma.DbNull,
        searchStartDate: null,
        searchEndDate: null,
      },
    });

    // Reset Home
    await client.home.updateMany({
      where: { userId: { in: userIds } },
      data: {
        addressFormatted: null,
        addressPlaceId: null,
        lat: null,
        lng: null,
        homeType: null,
        nbRooms: null,
        surface: null,
        rent: null,
        description: null,
        intentId: null,
      },
    });
    await client.$executeRaw`
      UPDATE "Home" SET "geom" = NULL WHERE "userId" = ANY(${userIdArray})
    `;

    // Stop intents
    if (options?.stopIntents !== false) {
      await client.intent.updateMany({
        where: { userId: { in: userIds } },
        data: {
          isActivelySearching: false,
          isInFlow: false,
          searchStoppedAt: now,
        },
      });
    }

    return { metrics, s3Keys };
  }

  async deleteKeysSafe(keys: string[]): Promise<void> {
    if (!keys.length) return;
    try {
      await this.s3Service.deleteFiles(keys);
    } catch (error) {
      this.logger.error(
        `Failed to delete ${keys.length} S3 objects during cleanup: ${(error as Error).message}`,
      );
    }
  }
}
