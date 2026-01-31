import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MatchStatus, MatchType, HomeType, Prisma } from '@prisma/client';
import { PaymentStatus } from '../config/match-packs.config';
import { MatchingConfigService } from '../config/matching.config';
import { v4 as uuidv4 } from 'uuid';
import { NotificationOutboxService } from './notification-outbox.service';
import {
  MatchLogger,
  CheckResult,
  CheckResults,
  StepLog,
} from './match-debug.types';
import * as crypto from 'crypto';

/**
 * Triangle participant data structure
 */
interface TriangleParticipant {
  intentId: number;
  userId: number;
  homeId: number;
  searchId: number;
  firstName: string;
  lastName: string;
  homeAddressFormatted: string;
}

/**
 * Triangle match result from SQL query
 */
interface TriangleCandidate {
  intentA: number;
  intentB: number;
  intentC: number;
}

/**
 * Full intent data for triangle validation
 */
interface FullIntentData {
  id: number;
  userId: number;
  isInFlow: boolean;
  totalMatchesRemaining: number;
  homeId: number;
  searchId: number;
  home: {
    id: number;
    userId: number;
    lat: number;
    lng: number;
    rent: number;
    surface: number;
    nbRooms: number;
    homeType: HomeType;
    addressFormatted: string | null;
  };
  search: {
    id: number;
    minRent: number | null;
    maxRent: number | null;
    minRoomSurface: number | null;
    maxRoomSurface: number | null;
    minRoomNb: number | null;
    maxRoomNb: number | null;
    homeType: HomeType[] | null;
    searchStartDate: Date | null;
    searchEndDate: Date | null;
  };
  zones: Array<{
    id: number;
    searchId: number;
    latitude: number | null;
    longitude: number | null;
    radius: number | null;
    label: string | null;
  }>;
  user: {
    firstName: string;
    lastName: string;
  };
}

/**
 * TriangleMatchingService
 *
 * Handles triangle matching: A -> B -> C -> A cycles where:
 * - A gets B's home
 * - B gets C's home
 * - C gets A's home
 *
 * Algorithm:
 * 1. Build directed compatibility edges (IntentEdge table)
 * 2. Find triangle cycles via SQL join on edges
 * 3. Create 3 Match rows atomically with shared groupId
 *
 * ANTI-LOOP PROTECTION:
 * - Fetches candidates in batches (default 50)
 * - Maintains a blacklist of failed (B,C) pairs
 * - Stops after maxTotalAttempts (default 200) to prevent busy-loop
 * - SQL query excludes already-attempted pairs
 */
@Injectable()
export class TriangleMatchingService {
  private readonly logger = new Logger(TriangleMatchingService.name);
  private readonly SNAPSHOT_VERSION = 2; // Version 2 includes triangle metadata
  private readonly ALGORITHM_VERSION = '2.0.0';

  // Date overlap tolerance: 10% of interval or minimum 1 day
  private readonly DATE_OVERLAP_TOLERANCE = 0;
  private readonly MIN_TOLERANCE_DAYS = 0;

  // Anti-loop configuration
  private readonly TRIANGLE_BATCH_SIZE = 50; // Candidates per batch
  private readonly MAX_TOTAL_ATTEMPTS = 200; // Max candidates to try before stopping
  private readonly MAX_DB_BATCHES = 5; // Max batches to fetch from DB

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationOutboxService: NotificationOutboxService,
    private readonly config: MatchingConfigService,
  ) { }

  /**
   * Find and create triangle matches for a seeker
   * Called after STANDARD matching is done for this seeker
   *
   * ANTI-LOOP DESIGN:
   * - Fetches candidates in batches to avoid re-querying the same failed ones
   * - Maintains a blacklist of attempted (B,C) pairs
   * - Stops after MAX_TOTAL_ATTEMPTS to prevent busy-loop on "toxic" data
   * - Each batch excludes already-attempted pairs via SQL
   *
   * @returns Number of triangle matches created (each triangle = 3 Match rows)
   */
  async findAndCreateTriangles(
    seekerIntentId: number,
    maxTriangles: number,
    matchLogger: MatchLogger,
  ): Promise<number> {
    matchLogger.debug(
      `[Triangle] Starting triangle search for Intent=${seekerIntentId}`,
    );

    // Check seeker still has credits
    const seeker = await this.fetchIntentWithFullData(seekerIntentId);
    if (!seeker || !seeker.isInFlow || seeker.totalMatchesRemaining <= 0) {
      matchLogger.debug(
        `[Triangle] Seeker ${seekerIntentId} not eligible (no credits or not in flow)`,
      );
      return 0;
    }

    let trianglesCreated = 0;
    let totalAttempts = 0;
    let batchesFetched = 0;

    // Blacklist of failed (B,C) pairs - key format: "intentB-intentC"
    const attemptedPairs = new Set<string>();

    // Track failure reasons for summary logging
    const failureReasons: Record<string, number> = {};

    // Generate/update outgoing edges for seeker (A -> B)
    await this.generateOutgoingEdges(seekerIntentId, matchLogger);

    // Generate incoming edges to seeker (C -> A)
    await this.generateIncomingEdges(seekerIntentId, matchLogger);

    // Main loop: fetch batches and try candidates
    while (
      trianglesCreated < maxTriangles &&
      totalAttempts < this.MAX_TOTAL_ATTEMPTS &&
      batchesFetched < this.MAX_DB_BATCHES
    ) {
      // Re-check seeker credits before fetching new batch
      const currentCredits = await this.getIntentCredits(seekerIntentId);
      if (currentCredits <= 0) {
        matchLogger.debug(
          `[Triangle] Seeker ${seekerIntentId} ran out of credits`,
        );
        break;
      }

      // Fetch a batch of candidates, excluding already-attempted pairs
      const candidates = await this.findTriangleCandidates(
        seekerIntentId,
        this.TRIANGLE_BATCH_SIZE,
        attemptedPairs,
        matchLogger,
      );
      batchesFetched++;

      if (candidates.length === 0) {
        matchLogger.debug(
          `[Triangle] No more candidates found for Intent=${seekerIntentId} (batch #${batchesFetched})`,
        );
        break;
      }

      matchLogger.debug(
        `[Triangle] Batch #${batchesFetched}: ${candidates.length} candidates for Intent=${seekerIntentId}`,
      );

      // Try each candidate in the batch
      for (const candidate of candidates) {
        // Guard: stop if we've created enough or hit limits
        if (
          trianglesCreated >= maxTriangles ||
          totalAttempts >= this.MAX_TOTAL_ATTEMPTS
        ) {
          break;
        }

        // Mark as attempted (add to blacklist)
        const pairKey = `${candidate.intentB}-${candidate.intentC}`;
        attemptedPairs.add(pairKey);
        totalAttempts++;

        // Attempt to create the triangle match
        const result = await this.createTriangleTransactionWithReason(
          candidate.intentA,
          candidate.intentB,
          candidate.intentC,
          matchLogger,
        );

        if (result.success) {
          trianglesCreated++;
          matchLogger.info(
            `[Triangle] Created triangle #${trianglesCreated}: ${candidate.intentA} -> ${candidate.intentB} -> ${candidate.intentC} -> ${candidate.intentA}`,
          );
        } else {
          // Track failure reason
          const reason = result.reason || 'UNKNOWN';
          failureReasons[reason] = (failureReasons[reason] || 0) + 1;
        }
      }
    }

    // Log summary if there were failures
    if (Object.keys(failureReasons).length > 0) {
      const summary = Object.entries(failureReasons)
        .map(([reason, count]) => `${reason}:${count}`)
        .join(', ');
      matchLogger.debug(
        `[Triangle] Intent=${seekerIntentId} - ${trianglesCreated} created, ${totalAttempts} attempted, failures: ${summary}`,
      );
    }

    return trianglesCreated;
  }

  /**
   * Get current credits for an intent
   */
  private async getIntentCredits(intentId: number): Promise<number> {
    const intent = await this.prisma.intent.findUnique({
      where: { id: intentId },
      select: { totalMatchesRemaining: true, isInFlow: true },
    });
    return intent?.isInFlow ? (intent.totalMatchesRemaining ?? 0) : 0;
  }

  /**
   * Generate outgoing edges for an intent (A -> B where B's home matches A's search)
   * Uses PostGIS ST_DWithin for zone filtering
   */
  private async generateOutgoingEdges(
    intentId: number,
    matchLogger: MatchLogger,
  ): Promise<void> {
    matchLogger.debug(
      `[Triangle][Edges] Generating outgoing edges for Intent=${intentId}`,
    );

    // SQL query to find compatible homes using PostGIS
    // Returns intent IDs whose homes match this seeker's search criteria
    const edgesQuery = Prisma.sql`
      WITH seeker AS (
        SELECT
          i.id as intent_id,
          i."userId" as user_id,
          s.id as search_id,
          s."minRent",
          s."maxRent",
          s."minRoomSurface",
          s."maxRoomSurface",
          s."minRoomNb",
          s."maxRoomNb",
          s."homeType" as search_home_types,
          s."searchStartDate",
          s."searchEndDate"
        FROM "Intent" i
        JOIN "Search" s ON s.id = i."searchId"
        WHERE i.id = ${intentId}
      ),
      seeker_zones AS (
        SELECT
          sa."searchId",
          sa.geom,
          sa.radius
        FROM "SearchAdress" sa
        JOIN seeker ON sa."searchId" = seeker.search_id
        WHERE sa.geom IS NOT NULL AND sa.radius IS NOT NULL
      ),
      candidates AS (
        SELECT
          i.id as to_intent_id,
          h.id as home_id,
          h.rent,
          h.surface,
          h."nbRooms",
          h."homeType",
          h.geom as home_geom,
          i2."searchStartDate" as target_start,
          i2."searchEndDate" as target_end,
          -- Score: closer rent to seeker's max = higher score
          CASE
            WHEN seeker."maxRent" IS NOT NULL THEN 100.0 - ABS(h.rent - seeker."maxRent")
            ELSE 50.0
          END as score
        FROM "Intent" i
        JOIN "Home" h ON h.id = i."homeId"
        JOIN "Search" i2 ON i2.id = i."searchId"
        CROSS JOIN seeker
        WHERE i."isInFlow" = true
          AND i."totalMatchesRemaining" > 0
          AND i."homeId" IS NOT NULL
          AND i."searchId" IS NOT NULL
          AND i."userId" != seeker.user_id
          -- Rent bounds
          AND (seeker."minRent" IS NULL OR h.rent >= seeker."minRent")
          AND (seeker."maxRent" IS NULL OR h.rent <= seeker."maxRent")
          -- Surface bounds
          AND (seeker."minRoomSurface" IS NULL OR h.surface >= seeker."minRoomSurface")
          AND (seeker."maxRoomSurface" IS NULL OR h.surface <= seeker."maxRoomSurface")
          -- Rooms bounds
          AND (seeker."minRoomNb" IS NULL OR h."nbRooms" >= seeker."minRoomNb")
          AND (seeker."maxRoomNb" IS NULL OR h."nbRooms" <= seeker."maxRoomNb")
          -- HomeType filter (JSON array contains check)
          AND (
            seeker.search_home_types IS NULL
            OR seeker.search_home_types = '[]'::jsonb
            OR seeker.search_home_types @> to_jsonb(h."homeType"::text)
          )
          -- Zone filter: home must be in at least one zone (if zones exist)
          AND (
            NOT EXISTS (SELECT 1 FROM seeker_zones)
            OR EXISTS (
              SELECT 1 FROM seeker_zones sz
              WHERE h.geom IS NOT NULL
                AND ST_DWithin(h.geom::geography, sz.geom::geography, sz.radius)
            )
          )
        LIMIT ${this.config.candidateLimit}
      )
      SELECT to_intent_id, score FROM candidates
    `;

    const candidates =
      await this.prisma.$queryRaw<
        Array<{ to_intent_id: number; score: number }>
      >(edgesQuery);

    matchLogger.debug(
      `[Triangle][Edges] Found ${candidates.length} outgoing edge candidates for Intent=${intentId}`,
    );

    // Bulk upsert edges using ON CONFLICT for performance
    if (candidates.length > 0) {
      const values = candidates.map(
        (c) =>
          Prisma.sql`(${intentId}, ${c.to_intent_id}, ${c.score}, NOW(), NOW())`,
      );

      await this.prisma.$executeRaw`
        INSERT INTO "IntentEdge" ("fromIntentId", "toIntentId", score, "computedAt", "updatedAt")
        VALUES ${Prisma.join(values)}
        ON CONFLICT ("fromIntentId", "toIntentId")
        DO UPDATE SET
          score = EXCLUDED.score,
          "computedAt" = NOW(),
          "updatedAt" = NOW()
      `;
    }
  }

  /**
   * Generate incoming edges to an intent (C -> A where A's home matches C's search)
   * This finds who wants the seeker's home
   */
  private async generateIncomingEdges(
    intentId: number,
    matchLogger: MatchLogger,
  ): Promise<void> {
    matchLogger.debug(
      `[Triangle][Edges] Generating incoming edges for Intent=${intentId}`,
    );

    // Find all intents whose search matches this intent's home
    const edgesQuery = Prisma.sql`
      WITH target_home AS (
        SELECT
          i.id as intent_id,
          i."userId" as user_id,
          h.id as home_id,
          h.lat,
          h.lng,
          h.geom,
          h.rent,
          h.surface,
          h."nbRooms",
          h."homeType"
        FROM "Intent" i
        JOIN "Home" h ON h.id = i."homeId"
        WHERE i.id = ${intentId}
      ),
      candidates AS (
        SELECT
          i.id as from_intent_id,
          s."minRent",
          s."maxRent",
          s."minRoomSurface",
          s."maxRoomSurface",
          s."minRoomNb",
          s."maxRoomNb",
          s."homeType" as search_home_types,
          -- Score
          CASE
            WHEN s."maxRent" IS NOT NULL THEN 100.0 - ABS(th.rent - s."maxRent")
            ELSE 50.0
          END as score
        FROM "Intent" i
        JOIN "Search" s ON s.id = i."searchId"
        CROSS JOIN target_home th
        WHERE i."isInFlow" = true
          AND i."totalMatchesRemaining" > 0
          AND i."homeId" IS NOT NULL
          AND i."searchId" IS NOT NULL
          AND i."userId" != th.user_id
          -- Rent bounds
          AND (s."minRent" IS NULL OR th.rent >= s."minRent")
          AND (s."maxRent" IS NULL OR th.rent <= s."maxRent")
          -- Surface bounds
          AND (s."minRoomSurface" IS NULL OR th.surface >= s."minRoomSurface")
          AND (s."maxRoomSurface" IS NULL OR th.surface <= s."maxRoomSurface")
          -- Rooms bounds
          AND (s."minRoomNb" IS NULL OR th."nbRooms" >= s."minRoomNb")
          AND (s."maxRoomNb" IS NULL OR th."nbRooms" <= s."maxRoomNb")
          -- HomeType filter
          AND (
            s."homeType" IS NULL
            OR s."homeType" = '[]'::jsonb
            OR s."homeType" @> to_jsonb(th."homeType"::text)
          )
          -- Zone filter: target home must be in at least one of candidate's zones
          AND (
            NOT EXISTS (
              SELECT 1 FROM "SearchAdress" sa
              WHERE sa."searchId" = s.id AND sa.geom IS NOT NULL
            )
            OR EXISTS (
              SELECT 1 FROM "SearchAdress" sa
              WHERE sa."searchId" = s.id
                AND sa.geom IS NOT NULL
                AND th.geom IS NOT NULL
                AND ST_DWithin(th.geom::geography, sa.geom::geography, sa.radius)
            )
          )
        LIMIT ${this.config.candidateLimit}
      )
      SELECT from_intent_id, score FROM candidates
    `;

    const candidates =
      await this.prisma.$queryRaw<
        Array<{ from_intent_id: number; score: number }>
      >(edgesQuery);

    matchLogger.debug(
      `[Triangle][Edges] Found ${candidates.length} incoming edge candidates for Intent=${intentId}`,
    );

    // Bulk upsert edges using ON CONFLICT for performance
    if (candidates.length > 0) {
      const values = candidates.map(
        (c) =>
          Prisma.sql`(${c.from_intent_id}, ${intentId}, ${c.score}, NOW(), NOW())`,
      );

      await this.prisma.$executeRaw`
        INSERT INTO "IntentEdge" ("fromIntentId", "toIntentId", score, "computedAt", "updatedAt")
        VALUES ${Prisma.join(values)}
        ON CONFLICT ("fromIntentId", "toIntentId")
        DO UPDATE SET
          score = EXCLUDED.score,
          "computedAt" = NOW(),
          "updatedAt" = NOW()
      `;
    }
  }

  /**
   * Find multiple triangle candidates for a given seeker (A)
   * Returns list of A -> B -> C -> A triangles where all edges exist and no existing matches
   *
   * OPTIMIZATIONS:
   * - Excludes already-attempted (B,C) pairs via excludeSet
   * - Returns DISTINCT triangles ordered by score
   * - Filters out locked intents (matchingProcessingUntil > now)
   * - Checks for existing matches to avoid rollback
   */
  private async findTriangleCandidates(
    intentA: number,
    limit: number,
    excludeSet: Set<string>,
    matchLogger: MatchLogger,
  ): Promise<TriangleCandidate[]> {
    // Build exclusion array for SQL - format: ARRAY[ARRAY[b1,c1], ARRAY[b2,c2], ...]
    const excludePairs = Array.from(excludeSet).map((key) => {
      const [b, c] = key.split('-').map(Number);
      return [b, c];
    });

    // SQL query to find triangle via edge joins
    // A -> B (edge exists)
    // B -> C (edge exists)
    // C -> A (edge exists)
    // All distinct
    // No existing matches between any pair
    // Excludes already-attempted pairs
    const triangleQuery = Prisma.sql`
      WITH excluded_pairs AS (
        SELECT unnest(${excludePairs.length > 0 ? excludePairs.map((p) => p[0]) : [0]}::int[]) as b,
               unnest(${excludePairs.length > 0 ? excludePairs.map((p) => p[1]) : [0]}::int[]) as c
      ),
      triangle_candidates AS (
        SELECT DISTINCT ON (ab."toIntentId", bc."toIntentId")
          ab."fromIntentId" as intent_a,
          ab."toIntentId" as intent_b,
          bc."toIntentId" as intent_c,
          (COALESCE(ab.score, 0) + COALESCE(bc.score, 0) + COALESCE(ca.score, 0)) as total_score
        FROM "IntentEdge" ab
        JOIN "IntentEdge" bc ON bc."fromIntentId" = ab."toIntentId"
        JOIN "IntentEdge" ca ON ca."fromIntentId" = bc."toIntentId" AND ca."toIntentId" = ab."fromIntentId"
        JOIN "Intent" ia ON ia.id = ab."fromIntentId"
        JOIN "Intent" ib ON ib.id = ab."toIntentId"
        JOIN "Intent" ic ON ic.id = bc."toIntentId"
        JOIN "Home" hb ON hb.id = ib."homeId"
        JOIN "Home" hc ON hc.id = ic."homeId"
        JOIN "Home" ha ON ha.id = ia."homeId"
        WHERE ab."fromIntentId" = ${intentA}
          AND ab."toIntentId" != ${intentA}
          AND bc."toIntentId" != ${intentA}
          AND ab."toIntentId" != bc."toIntentId"
          -- All participants must be eligible
          AND ia."isInFlow" = true AND ia."totalMatchesRemaining" > 0
          AND ib."isInFlow" = true AND ib."totalMatchesRemaining" > 0
          AND ic."isInFlow" = true AND ic."totalMatchesRemaining" > 0
          -- Participants should be actively searching
          AND ia."isActivelySearching" = true
          AND ib."isActivelySearching" = true
          AND ic."isActivelySearching" = true
          -- No locked intents (being processed by another worker)
          AND (ia."matchingProcessingUntil" IS NULL OR ia."matchingProcessingUntil" <= NOW())
          AND (ib."matchingProcessingUntil" IS NULL OR ib."matchingProcessingUntil" <= NOW())
          AND (ic."matchingProcessingUntil" IS NULL OR ic."matchingProcessingUntil" <= NOW())
          -- PRIORITY FIX: Exclude triangles where A↔B could be a STANDARD match
          -- If B→A edge exists, then A and B should match as STANDARD, not TRIANGLE
          AND NOT EXISTS (
            SELECT 1 FROM "IntentEdge" reverse_ab
            WHERE reverse_ab."fromIntentId" = ab."toIntentId"   -- B
              AND reverse_ab."toIntentId" = ab."fromIntentId"    -- A
          )
          -- PRIORITY FIX: Exclude triangles where B↔C could be a STANDARD match
          -- If C→B edge exists, then B and C should match as STANDARD, not TRIANGLE
          AND NOT EXISTS (
            SELECT 1 FROM "IntentEdge" reverse_bc
            WHERE reverse_bc."fromIntentId" = bc."toIntentId"   -- C
              AND reverse_bc."toIntentId" = bc."fromIntentId"    -- B
          )
          -- No existing matches between any pair (check by targetHomeId for uniqueness)
          AND NOT EXISTS (
            SELECT 1 FROM "Match" m
            WHERE (m."seekerIntentId" = ab."fromIntentId" AND m."targetHomeId" = hb.id)
               OR (m."seekerIntentId" = ab."toIntentId" AND m."targetHomeId" = hc.id)
               OR (m."seekerIntentId" = bc."toIntentId" AND m."targetHomeId" = ha.id)
          )
          -- Exclude already-attempted (B,C) pairs
          AND NOT EXISTS (
            SELECT 1 FROM excluded_pairs ep
            WHERE ep.b = ab."toIntentId" AND ep.c = bc."toIntentId"
          )
        ORDER BY ab."toIntentId", bc."toIntentId", total_score DESC
      )
      SELECT intent_a, intent_b, intent_c
      FROM triangle_candidates
      ORDER BY total_score DESC
      LIMIT ${limit}
    `;

    const results = await this.prisma.$queryRaw<
      Array<{
        intent_a: number;
        intent_b: number;
        intent_c: number;
      }>
    >(triangleQuery);

    return results.map((r) => ({
      intentA: r.intent_a,
      intentB: r.intent_b,
      intentC: r.intent_c,
    }));
  }

  /**
   * Create triangle match in a single atomic transaction
   * Returns success status AND failure reason for tracking
   *
   * - Verifies all 3 participants still eligible
   * - Consumes 1 credit from each via unified method
   * - Creates 3 Match rows with shared groupId
   * - Writes outbox events for ALL 3 participants
   */
  private async createTriangleTransactionWithReason(
    intentAId: number,
    intentBId: number,
    intentCId: number,
    matchLogger: MatchLogger,
  ): Promise<{ success: boolean; reason?: string }> {
    const groupId = uuidv4();
    const runId = matchLogger.getRunId();

    matchLogger.logTransaction(intentAId, intentBId, 'START', {
      type: 'TRIANGLE',
      groupId,
      intentC: intentCId,
    });

    try {
      await this.prisma.safeTransaction(async (tx) => {
        // Re-fetch all 3 intents with fresh data
        const [intentA, intentB, intentC] = await Promise.all([
          this.fetchIntentWithFullDataTx(tx, intentAId),
          this.fetchIntentWithFullDataTx(tx, intentBId),
          this.fetchIntentWithFullDataTx(tx, intentCId),
        ]);

        // Validate all 3 are eligible
        if (!intentA || !intentB || !intentC) {
          throw new Error('INTENT_NOT_FOUND');
        }

        if (!intentA.isInFlow || intentA.totalMatchesRemaining <= 0) {
          throw new Error('A_NOT_ELIGIBLE');
        }
        if (!intentB.isInFlow || intentB.totalMatchesRemaining <= 0) {
          throw new Error('B_NOT_ELIGIBLE');
        }
        if (!intentC.isInFlow || intentC.totalMatchesRemaining <= 0) {
          throw new Error('C_NOT_ELIGIBLE');
        }

        // Check for existing matches (anti-duplicate)
        const existingMatch = await tx.match.findFirst({
          where: {
            OR: [
              { seekerIntentId: intentAId, targetHomeId: intentB.homeId },
              { seekerIntentId: intentBId, targetHomeId: intentC.homeId },
              { seekerIntentId: intentCId, targetHomeId: intentA.homeId },
            ],
          },
        });

        if (existingMatch) {
          throw new Error('DUPLICATE_MATCH');
        }

        // Build snapshot with triangle metadata (includes evaluation details)
        const snapshot = this.buildTriangleSnapshot(
          groupId,
          intentA,
          intentB,
          intentC,
        );

        // Consume payment credits for each participant (FIFO from oldest payment)
        // This is atomic: if any fails, the whole transaction rolls back
        await this.consumePaymentCreditForIntent(
          tx,
          intentA.userId,
          intentAId,
          'A',
        );
        await this.consumePaymentCreditForIntent(
          tx,
          intentB.userId,
          intentBId,
          'B',
        );
        await this.consumePaymentCreditForIntent(
          tx,
          intentC.userId,
          intentCId,
          'C',
        );

        // Create 3 Match rows
        // A gets B's home
        const matchA = await tx.match.create({
          data: {
            seekerIntentId: intentAId,
            targetIntentId: intentBId,
            targetHomeId: intentB.homeId,
            status: MatchStatus.NEW,
            type: MatchType.TRIANGLE,
            groupId,
            snapshot,
            snapshotVersion: this.SNAPSHOT_VERSION,
          },
        });

        // B gets C's home
        const matchB = await tx.match.create({
          data: {
            seekerIntentId: intentBId,
            targetIntentId: intentCId,
            targetHomeId: intentC.homeId,
            status: MatchStatus.NEW,
            type: MatchType.TRIANGLE,
            groupId,
            snapshot,
            snapshotVersion: this.SNAPSHOT_VERSION,
          },
        });

        // C gets A's home
        const matchC = await tx.match.create({
          data: {
            seekerIntentId: intentCId,
            targetIntentId: intentAId,
            targetHomeId: intentA.homeId,
            status: MatchStatus.NEW,
            type: MatchType.TRIANGLE,
            groupId,
            snapshot,
            snapshotVersion: this.SNAPSHOT_VERSION,
          },
        });

        // Decrement credits for all 3
        for (const intent of [intentA, intentB, intentC]) {
          const newCredits = intent.totalMatchesRemaining - 1;
          await tx.intent.update({
            where: { id: intent.id },
            data: {
              totalMatchesRemaining: newCredits,
              totalMatchesUsed: { increment: 1 },
              isInFlow: newCredits > 0,
            },
          });
        }

        // Write outbox events for ALL 3 participants (atomic with match creation)
        // Each user sees "1 new triangle match" even though 3 Match rows were created
        await this.notificationOutboxService.writeTriangleMatchOutbox(
          tx,
          runId,
          [
            { intentId: intentAId, userId: intentA.userId },
            { intentId: intentBId, userId: intentB.userId },
            { intentId: intentCId, userId: intentC.userId },
          ],
          [matchA.uid, matchB.uid, matchC.uid],
        );
      });

      matchLogger.logTransaction(intentAId, intentBId, 'COMMIT', {
        type: 'TRIANGLE',
        groupId,
        intentC: intentCId,
      });

      return { success: true };
    } catch (error: any) {
      const reason =
        error.code === 'P2002' ? 'DUPLICATE_CONSTRAINT' : error.message;

      matchLogger.logTransaction(intentAId, intentBId, 'ROLLBACK', {
        type: 'TRIANGLE',
        reason,
        intentC: intentCId,
      });

      // Known failure reasons - don't log as error
      const knownReasons = [
        'INTENT_NOT_FOUND',
        'A_NOT_ELIGIBLE',
        'B_NOT_ELIGIBLE',
        'C_NOT_ELIGIBLE',
        'DUPLICATE_MATCH',
        'DUPLICATE_CONSTRAINT',
        'INSUFFICIENT_PAYMENT_CREDITS_A',
        'INSUFFICIENT_PAYMENT_CREDITS_B',
        'INSUFFICIENT_PAYMENT_CREDITS_C',
      ];

      if (!knownReasons.includes(reason)) {
        // Unexpected error - log it
        matchLogger.error(
          `[Triangle] Unexpected error creating triangle: ${error.message}`,
          error,
        );
      }

      return { success: false, reason };
    }
  }

  /**
   * Consume one payment credit from the oldest active payment (FIFO)
   * Throws typed error with participant identifier for tracking
   */
  private async consumePaymentCreditForIntent(
    tx: Prisma.TransactionClient,
    userId: number,
    intentId: number,
    participantLabel: string,
  ): Promise<void> {
    const payments = await tx.payment.findMany({
      where: {
        userId,
        intentId,
        status: {
          in: [PaymentStatus.SUCCEEDED, PaymentStatus.PARTIALLY_REFUNDED],
        },
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        matchesInitial: true,
        matchesUsed: true,
        matchesRefunded: true,
        status: true,
      },
    });

    for (const payment of payments) {
      const refunded = payment.matchesRefunded ?? 0;
      const remaining = payment.matchesInitial - payment.matchesUsed - refunded;
      if (remaining > 0) {
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            matchesUsed: { increment: 1 },
          },
        });
        return;
      }
    }

    throw new Error(`INSUFFICIENT_PAYMENT_CREDITS_${participantLabel}`);
  }

  /**
   * Build triangle snapshot with all participant info and per-edge evaluation details
   * This ensures TRIANGLE matches have consistent, complete snapshot data
   */
  private buildTriangleSnapshot(
    groupId: string,
    intentA: FullIntentData,
    intentB: FullIntentData,
    intentC: FullIntentData,
  ): any {
    return {
      algorithmVersion: this.ALGORITHM_VERSION,
      snapshotVersion: this.SNAPSHOT_VERSION,
      matchType: 'TRIANGLE',
      groupId,
      createdAt: new Date().toISOString(),

      // Participants with full details
      participants: {
        A: {
          intentId: intentA.id,
          userId: intentA.userId,
          firstName: intentA.user.firstName,
          lastName: intentA.user.lastName,
          homeId: intentA.homeId,
          homeAddress: intentA.home.addressFormatted,
        },
        B: {
          intentId: intentB.id,
          userId: intentB.userId,
          firstName: intentB.user.firstName,
          lastName: intentB.user.lastName,
          homeId: intentB.homeId,
          homeAddress: intentB.home.addressFormatted,
        },
        C: {
          intentId: intentC.id,
          userId: intentC.userId,
          firstName: intentC.user.firstName,
          lastName: intentC.user.lastName,
          homeId: intentC.homeId,
          homeAddress: intentC.home.addressFormatted,
        },
      },

      // Chain explanation (for UI) - dynamic, role-aware
      chain: [
        {
          from: {
            userId: intentA.userId,
            name: `${intentA.user.firstName} ${intentA.user.lastName}`,
          },
          gets: {
            homeId: intentB.homeId,
            address: intentB.home.addressFormatted,
          },
          sendsTo: {
            userId: intentB.userId,
            name: `${intentB.user.firstName} ${intentB.user.lastName}`,
          },
        },
        {
          from: {
            userId: intentB.userId,
            name: `${intentB.user.firstName} ${intentB.user.lastName}`,
          },
          gets: {
            homeId: intentC.homeId,
            address: intentC.home.addressFormatted,
          },
          sendsTo: {
            userId: intentC.userId,
            name: `${intentC.user.firstName} ${intentC.user.lastName}`,
          },
        },
        {
          from: {
            userId: intentC.userId,
            name: `${intentC.user.firstName} ${intentC.user.lastName}`,
          },
          gets: {
            homeId: intentA.homeId,
            address: intentA.home.addressFormatted,
          },
          sendsTo: {
            userId: intentA.userId,
            name: `${intentA.user.firstName} ${intentA.user.lastName}`,
          },
        },
      ],

      // Home snapshots with full details
      homes: {
        [intentA.homeId]: this.mapHomeSnapshot(intentA.home),
        [intentB.homeId]: this.mapHomeSnapshot(intentB.home),
        [intentC.homeId]: this.mapHomeSnapshot(intentC.home),
      },

      // Search criteria snapshots (for "Pourquoi ce match?" section)
      searches: {
        [intentA.id]: this.mapSearchSnapshot(intentA.search, intentA.zones),
        [intentB.id]: this.mapSearchSnapshot(intentB.search, intentB.zones),
        [intentC.id]: this.mapSearchSnapshot(intentC.search, intentC.zones),
      },

      // Per-edge evaluation details (what criteria matched for each edge)
      edgeEvaluations: {
        // A -> B: A's search matches B's home
        A_to_B: this.buildEdgeEvaluation(intentA, intentB),
        // B -> C: B's search matches C's home
        B_to_C: this.buildEdgeEvaluation(intentB, intentC),
        // C -> A: C's search matches A's home
        C_to_A: this.buildEdgeEvaluation(intentC, intentA),
      },
    };
  }

  /**
   * Build per-edge evaluation showing what criteria matched
   */
  private buildEdgeEvaluation(
    seeker: FullIntentData,
    target: FullIntentData,
  ): any {
    const search = seeker.search;
    const home = target.home;

    return {
      seekerIntentId: seeker.id,
      targetIntentId: target.id,
      targetHomeId: home.id,
      // Rent check
      rent: {
        homeValue: home.rent,
        searchMin: search.minRent,
        searchMax: search.maxRent,
        passed:
          (search.minRent === null || home.rent >= search.minRent) &&
          (search.maxRent === null || home.rent <= search.maxRent),
      },
      // Surface check
      surface: {
        homeValue: home.surface,
        searchMin: search.minRoomSurface,
        searchMax: search.maxRoomSurface,
        passed:
          (search.minRoomSurface === null ||
            home.surface >= search.minRoomSurface) &&
          (search.maxRoomSurface === null ||
            home.surface <= search.maxRoomSurface),
      },
      // Rooms check
      rooms: {
        homeValue: home.nbRooms,
        searchMin: search.minRoomNb,
        searchMax: search.maxRoomNb,
        passed:
          (search.minRoomNb === null || home.nbRooms >= search.minRoomNb) &&
          (search.maxRoomNb === null || home.nbRooms <= search.maxRoomNb),
      },
      // HomeType check
      homeType: {
        homeValue: home.homeType,
        searchTypes: search.homeType,
        passed:
          !search.homeType ||
          search.homeType.length === 0 ||
          search.homeType.includes(home.homeType),
      },
      // Zone check (simplified - actual check done via PostGIS)
      zones: {
        homeLocation: { lat: home.lat, lng: home.lng },
        searchZones: seeker.zones.map((z) => ({
          label: z.label,
          lat: z.latitude,
          lng: z.longitude,
          radius: z.radius,
        })),
        passed: true, // If edge exists, zone check passed via PostGIS
      },
    };
  }

  /**
   * Map search criteria for snapshot
   */
  private mapSearchSnapshot(
    search: FullIntentData['search'],
    zones: FullIntentData['zones'],
  ): any {
    return {
      minRent: search.minRent,
      maxRent: search.maxRent,
      minSurface: search.minRoomSurface,
      maxSurface: search.maxRoomSurface,
      minRooms: search.minRoomNb,
      maxRooms: search.maxRoomNb,
      homeTypes: search.homeType,
      searchStartDate: search.searchStartDate?.toISOString() ?? null,
      searchEndDate: search.searchEndDate?.toISOString() ?? null,
      zones: zones.map((z) => ({
        label: z.label,
        lat: z.latitude,
        lng: z.longitude,
        radius: z.radius,
      })),
    };
  }

  private mapHomeSnapshot(home: FullIntentData['home']) {
    return {
      id: home.id,
      lat: home.lat,
      lng: home.lng,
      rent: home.rent,
      surface: home.surface,
      nbRooms: home.nbRooms,
      homeType: home.homeType,
      addressFormatted: home.addressFormatted,
    };
  }

  /**
   * Fetch intent with full data for triangle processing
   */
  private async fetchIntentWithFullData(
    intentId: number,
  ): Promise<FullIntentData | null> {
    const intent = await this.prisma.intent.findUnique({
      where: { id: intentId },
      select: {
        id: true,
        userId: true,
        isInFlow: true,
        totalMatchesRemaining: true,
        homeId: true,
        searchId: true,
        home: {
          select: {
            id: true,
            userId: true,
            lat: true,
            lng: true,
            rent: true,
            surface: true,
            nbRooms: true,
            homeType: true,
            addressFormatted: true,
          },
        },
        search: {
          select: {
            id: true,
            minRent: true,
            maxRent: true,
            minRoomSurface: true,
            maxRoomSurface: true,
            minRoomNb: true,
            maxRoomNb: true,
            homeType: true,
            searchStartDate: true,
            searchEndDate: true,
            searchAdresses: {
              select: {
                id: true,
                searchId: true,
                latitude: true,
                longitude: true,
                radius: true,
                label: true,
              },
            },
          },
        },
        user: {
          select: {
            firstName: true,
            lastName: true,
          },
        },
      },
    });

    if (
      !intent ||
      !intent.home ||
      !intent.search ||
      !intent.homeId ||
      !intent.searchId
    ) {
      return null;
    }

    const home = intent.home;
    if (
      home.lat === null ||
      home.lng === null ||
      home.rent === null ||
      home.surface === null ||
      home.nbRooms === null ||
      home.homeType === null
    ) {
      return null;
    }

    return {
      id: intent.id,
      userId: intent.userId,
      isInFlow: intent.isInFlow,
      totalMatchesRemaining: intent.totalMatchesRemaining,
      homeId: intent.homeId,
      searchId: intent.searchId,
      home: {
        id: home.id,
        userId: home.userId,
        lat: home.lat,
        lng: home.lng,
        rent: home.rent,
        surface: home.surface,
        nbRooms: home.nbRooms,
        homeType: home.homeType,
        addressFormatted: home.addressFormatted,
      },
      search: {
        ...intent.search,
        homeType: intent.search.homeType as HomeType[] | null,
      },
      zones: intent.search.searchAdresses,
      user: intent.user,
    };
  }

  /**
   * Fetch intent within transaction
   */
  private async fetchIntentWithFullDataTx(
    tx: Prisma.TransactionClient,
    intentId: number,
  ): Promise<FullIntentData | null> {
    const intent = await tx.intent.findUnique({
      where: { id: intentId },
      select: {
        id: true,
        userId: true,
        isInFlow: true,
        totalMatchesRemaining: true,
        homeId: true,
        searchId: true,
        home: {
          select: {
            id: true,
            userId: true,
            lat: true,
            lng: true,
            rent: true,
            surface: true,
            nbRooms: true,
            homeType: true,
            addressFormatted: true,
          },
        },
        search: {
          select: {
            id: true,
            minRent: true,
            maxRent: true,
            minRoomSurface: true,
            maxRoomSurface: true,
            minRoomNb: true,
            maxRoomNb: true,
            homeType: true,
            searchStartDate: true,
            searchEndDate: true,
            searchAdresses: {
              select: {
                id: true,
                searchId: true,
                latitude: true,
                longitude: true,
                radius: true,
                label: true,
              },
            },
          },
        },
        user: {
          select: {
            firstName: true,
            lastName: true,
          },
        },
      },
    });

    if (
      !intent ||
      !intent.home ||
      !intent.search ||
      !intent.homeId ||
      !intent.searchId
    ) {
      return null;
    }

    const home = intent.home;
    if (
      home.lat === null ||
      home.lng === null ||
      home.rent === null ||
      home.surface === null ||
      home.nbRooms === null ||
      home.homeType === null
    ) {
      return null;
    }

    return {
      id: intent.id,
      userId: intent.userId,
      isInFlow: intent.isInFlow,
      totalMatchesRemaining: intent.totalMatchesRemaining,
      homeId: intent.homeId,
      searchId: intent.searchId,
      home: {
        id: home.id,
        userId: home.userId,
        lat: home.lat,
        lng: home.lng,
        rent: home.rent,
        surface: home.surface,
        nbRooms: home.nbRooms,
        homeType: home.homeType,
        addressFormatted: home.addressFormatted,
      },
      search: {
        ...intent.search,
        homeType: intent.search.homeType as HomeType[] | null,
      },
      zones: intent.search.searchAdresses,
      user: intent.user,
    };
  }

  /**
   * Cleanup old edges (optional maintenance)
   * Call periodically to remove edges for intents no longer in flow
   */
  async cleanupStaleEdges(): Promise<number> {
    const result = await this.prisma.intentEdge.deleteMany({
      where: {
        OR: [
          { fromIntent: { isInFlow: false } },
          { toIntent: { isInFlow: false } },
          { fromIntent: { totalMatchesRemaining: { lte: 0 } } },
          { toIntent: { totalMatchesRemaining: { lte: 0 } } },
        ],
      },
    });

    return result.count;
  }
}
