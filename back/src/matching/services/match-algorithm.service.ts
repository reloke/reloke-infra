import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MatchStatus, MatchType, HomeType, Prisma } from '@prisma/client';
import { PaymentStatus } from '../config/match-packs.config';
import { MatchingConfigService } from '../config/matching.config';
import {
  MatchLogger,
  CheckResult,
  CheckResults,
  StepLog,
  ZoneCheckDetail,
} from './match-debug.types';
import { TriangleMatchingService } from './triangle-matching.service';
import { ConfigService } from '@nestjs/config/dist/config.service';
import { v4 as uuidv4 } from 'uuid';
import { NotificationOutboxService } from './notification-outbox.service';

/**
 * Type definitions for the matching algorithm
 */
interface IntentData {
  id: number;
  userId: number;
  isInFlow: boolean;
  totalMatchesRemaining: number;
  homeId: number;
  searchId: number;
}

interface HomeData {
  id: number;
  userId: number;
  lat: number;
  lng: number;
  rent: number;
  surface: number;
  nbRooms: number;
  homeType: HomeType;
  addressFormatted?: string | null;
}

interface SearchData {
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
}

interface ZoneData {
  id: number;
  searchId: number;
  latitude: number | null;
  longitude: number | null;
  radius: number | null;
  label: string | null;
}

interface FullIntentData extends IntentData {
  home: HomeData;
  search: SearchData;
  zones: ZoneData[];
}

interface MatchingRunStats {
  seekersProcessed: number;
  candidatesConsidered: number;
  matchesCreated: number;
  triangleMatchesCreated: number;
  usersRemovedFromFlow: number;
}

/**
 * MatchAlgorithmService - OPTIMIZED VERSION with DEBUG LOGGING
 *
 * Key optimizations:
 * 1. Batch fetch all eligible intents with homes/searches/zones in ONE query
 * 2. Pre-fetch existing matches as a Map for O(1) lookup
 * 3. Use SQL filtering to reduce candidates (rent, surface, rooms bounds + bounding box)
 * 4. Candidates searched from WHOLE DB (not just current batch)
 * 5. Reciprocal checks done in memory on reduced set
 * 6. Single transaction for creating both match rows + consuming credits
 *
 * Debug features:
 * - MATCHING_DEBUG=true for detailed logs
 * - MATCHING_TRACE_USER_A=<userId> + MATCHING_TRACE_USER_B=<userId> for tracing specific pair
 */
@Injectable()
export class MatchAlgorithmService {
  private readonly logger = new Logger(MatchAlgorithmService.name);
  private readonly ALGORITHM_VERSION = '1.0.0';
  private readonly SNAPSHOT_VERSION = 1;

  // Earth radius in meters for Haversine formula
  private readonly EARTH_RADIUS_M = 6371000;

  // Date overlap tolerance: 10% of interval or minimum 1 day
  private readonly DATE_OVERLAP_TOLERANCE = 0;
  private readonly MIN_TOLERANCE_DAYS = 0;

  // Bounding box expansion factor for initial geo filtering (degrees)
  // Approx 1 degree = 111km, so 0.5 degrees ~ 55km max radius coverage
  private readonly BBOX_EXPANSION_DEG = 0.5;

  // Maximum triangles to attempt per seeker per run
  private readonly MAX_TRIANGLES_PER_SEEKER = 50;

  // Enable/disable triangle matching
  private readonly triangleEnabled: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly triangleMatchingService: TriangleMatchingService,
    private configService: ConfigService,
    private readonly notificationOutboxService: NotificationOutboxService,
    private readonly matchingConfig: MatchingConfigService,
  ) {
    this.triangleEnabled =
      (this.configService.get<string>('TRIANGLE_MATCHING_ENABLED') || '') !==
      'false';
  }

  /**
   * Main entry point: Run matching algorithm for all eligible intents
   * Called by cron job every 10 minutes
   */
  async runMatchingBatch(batchSize = 100): Promise<MatchingRunStats> {
    const matchLogger = new MatchLogger();
    const startTime = Date.now();

    matchLogger.info(
      `Starting matching batch (batchSize=${batchSize}, debug=${matchLogger.isDebugMode()})`,
    );
    await this.logEligibilityCounts(matchLogger);
    await this.repairMissingIntentLinks(matchLogger);

    const stats: MatchingRunStats = {
      seekersProcessed: 0,
      candidatesConsidered: 0,
      matchesCreated: 0,
      triangleMatchesCreated: 0,
      usersRemovedFromFlow: 0,
    };

    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      // PHASE 1: Fetch batch of eligible seekers with all their data
      matchLogger.debug(`Fetching eligible seekers batch (offset=${offset})`);
      const seekers = await this.fetchEligibleIntentsWithFullData(
        batchSize,
        offset,
      );

      if (seekers.length === 0) {
        matchLogger.info(
          'No eligible seekers found in this batch (after filters)',
        );
        hasMore = false;
        break;
      }

      matchLogger.info(
        `Processing batch of ${seekers.length} seekers (offset=${offset})`,
      );

      // PHASE 2: Pre-fetch existing matches for all seekers in this batch
      const seekerIds = seekers.map((s) => s.id);
      const existingMatchesMap = await this.fetchExistingMatchesMap(seekerIds);
      matchLogger.debug(
        `Pre-fetched existing matches for ${seekerIds.length} seekers`,
      );

      // PHASE 3: Process each seeker (STANDARD matches first, then TRIANGLE)
      for (const seeker of seekers) {
        // Skip if seeker no longer has credits (may have been consumed earlier in this run)
        if (seeker.totalMatchesRemaining <= 0 || !seeker.isInFlow) {
          matchLogger.debug(
            `Seeker ${seeker.id} (user=${seeker.userId}) skipped: no credits or not in flow`,
          );
          continue;
        }

        // STEP 1: Create STANDARD (reciprocal) matches
        const matchesCreated = await this.processSeeker(
          seeker,
          existingMatchesMap.get(seeker.id) || new Set(),
          matchLogger,
          stats,
        );

        stats.matchesCreated += matchesCreated;

        // STEP 2: If seeker still has credits and triangles enabled, try TRIANGLE matches
        if (this.triangleEnabled) {
          // Re-check credits after STANDARD matching
          const remainingCredits = await this.getIntentCredits(seeker.id);
          if (remainingCredits > 0) {
            matchLogger.debug(
              `Seeker ${seeker.id}: ${remainingCredits} credits left, trying TRIANGLE matching`,
            );

            const trianglesCreated =
              await this.triangleMatchingService.findAndCreateTriangles(
                seeker.id,
                Math.min(remainingCredits, this.MAX_TRIANGLES_PER_SEEKER),
                matchLogger,
              );

            if (trianglesCreated > 0) {
              // Each triangle creates 3 Match rows
              stats.triangleMatchesCreated += trianglesCreated * 3;
              matchLogger.info(
                `Seeker ${seeker.id}: created ${trianglesCreated} triangle(s) (${trianglesCreated * 3} Match rows)`,
              );
            }
          }
        }

        stats.seekersProcessed++;
      }

      offset += batchSize;
      hasMore = seekers.length === batchSize;
    }

    const durationMs = Date.now() - startTime;
    matchLogger.logSummary({ ...stats, durationMs });

    return stats;
  }

  /**
   * PHASE 1: Fetch eligible intents with all related data in ONE query
   */
  private async fetchEligibleIntentsWithFullData(
    limit: number,
    offset: number,
  ): Promise<FullIntentData[]> {
    const intents = await this.prisma.intent.findMany({
      where: {
        isInFlow: true,
        totalMatchesRemaining: { gt: 0 },
        homeId: { not: null },
        searchId: { not: null },
      },
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
      },
      take: limit,
      skip: offset,
      orderBy: { id: 'asc' },
    });

    const results: FullIntentData[] = [];
    for (const i of intents) {
      if (!i.home || !i.search || !i.homeId || !i.searchId) {
        continue;
      }

      const home = i.home;
      if (
        home.lat === null ||
        home.lng === null ||
        home.rent === null ||
        home.surface === null ||
        home.nbRooms === null ||
        home.homeType === null
      ) {
        continue;
      }

      results.push({
        id: i.id,
        userId: i.userId,
        isInFlow: i.isInFlow,
        totalMatchesRemaining: i.totalMatchesRemaining,
        homeId: i.homeId,
        searchId: i.searchId,
        home: {
          id: home.id,
          userId: home.userId,
          lat: home.lat,
          lng: home.lng,
          rent: home.rent,
          surface: home.surface,
          nbRooms: home.nbRooms,
          homeType: home.homeType,
          addressFormatted: home.addressFormatted ?? null,
        },
        search: {
          ...i.search,
          homeType: i.search.homeType as HomeType[] | null,
        },
        zones: i.search.searchAdresses,
      });
    }

    return results;
  }

  /**
   * PHASE 2: Fetch existing matches as a Map for O(1) lookup
   */
  private async fetchExistingMatchesMap(
    seekerIntentIds: number[],
  ): Promise<Map<number, Set<number>>> {
    const matches = await this.prisma.match.findMany({
      where: { seekerIntentId: { in: seekerIntentIds } },
      select: { seekerIntentId: true, targetHomeId: true },
    });

    const map = new Map<number, Set<number>>();
    for (const m of matches) {
      if (!map.has(m.seekerIntentId)) {
        map.set(m.seekerIntentId, new Set());
      }
      map.get(m.seekerIntentId)!.add(m.targetHomeId);
    }

    return map;
  }

  /**
   * PHASE 3: Process a single seeker - find candidates from WHOLE DB
   */
  private async processSeeker(
    seeker: FullIntentData,
    existingMatchedHomeIds: Set<number>,
    matchLogger: MatchLogger,
    stats: MatchingRunStats,
  ): Promise<number> {
    let matchesCreated = 0;

    matchLogger.debug(
      `Processing seeker Intent=${seeker.id} User=${seeker.userId} Credits=${seeker.totalMatchesRemaining}`,
    );

    // Use SQL to find candidate homes that match seeker's search criteria
    // This searches the WHOLE DB, not just the current batch
    const candidates = await this.findCandidateIntents(
      seeker,
      existingMatchedHomeIds,
      matchLogger,
    );

    matchLogger.debug(
      `Seeker ${seeker.id}: found ${candidates.length} candidates after SQL filtering`,
    );
    stats.candidatesConsidered += candidates.length;

    for (const target of candidates) {
      // Re-check seeker still has credits (may have been consumed in this loop)
      const seekerCredits = await this.getIntentCredits(seeker.id);
      if (seekerCredits <= 0) {
        matchLogger.debug(`Seeker ${seeker.id} ran out of credits, stopping`);
        break;
      }

      // Evaluate reciprocal match with detailed logging
      const evaluation = this.evaluateReciprocalMatch(
        seeker,
        target,
        matchLogger,
      );

      if (evaluation.passed) {
        // Create match in transaction
        const created = await this.createReciprocalMatchTransaction(
          seeker,
          target,
          evaluation,
          matchLogger,
          stats,
        );
        if (created) {
          matchesCreated += 2;
        }
      }
    }

    return matchesCreated;
  }

  /**
   * SQL-optimized candidate search
   * Searches WHOLE DB with filters:
   * - Not self
   * - Not already matched
   * - Rent within seeker's search bounds
   * - Surface within seeker's search bounds
   * - Rooms within seeker's search bounds
   * - HomeType in seeker's search list (if specified)
   * - Bounding box pre-filter for zones
   * - Target is in flow with credits > 0
   */
  private async findCandidateIntents(
    seeker: FullIntentData,
    existingMatchedHomeIds: Set<number>,
    matchLogger: MatchLogger,
  ): Promise<FullIntentData[]> {
    const search = seeker.search;

    // Build WHERE conditions for Home
    const homeConditions: Prisma.HomeWhereInput = {
      userId: { not: seeker.userId },
    };

    // Exclude already matched homes
    if (existingMatchedHomeIds.size > 0) {
      homeConditions.id = { notIn: Array.from(existingMatchedHomeIds) };
    }

    // Rent bounds
    if (search.minRent !== null) {
      homeConditions.rent = {
        ...((homeConditions.rent as object) || {}),
        gte: search.minRent,
      };
    }
    if (search.maxRent !== null) {
      homeConditions.rent = {
        ...((homeConditions.rent as object) || {}),
        lte: search.maxRent,
      };
    }

    // Surface bounds
    if (search.minRoomSurface !== null) {
      homeConditions.surface = {
        ...((homeConditions.surface as object) || {}),
        gte: search.minRoomSurface,
      };
    }
    if (search.maxRoomSurface !== null) {
      homeConditions.surface = {
        ...((homeConditions.surface as object) || {}),
        lte: search.maxRoomSurface,
      };
    }

    // Rooms bounds
    if (search.minRoomNb !== null) {
      homeConditions.nbRooms = {
        ...((homeConditions.nbRooms as object) || {}),
        gte: search.minRoomNb,
      };
    }
    if (search.maxRoomNb !== null) {
      homeConditions.nbRooms = {
        ...((homeConditions.nbRooms as object) || {}),
        lte: search.maxRoomNb,
      };
    }

    // HomeType filter
    if (search.homeType && search.homeType.length > 0) {
      homeConditions.homeType = { in: search.homeType };
    }

    // Bounding box filter based on seeker's zones
    const bbox = this.computeBoundingBox(seeker.zones);
    if (bbox) {
      homeConditions.lat = { gte: bbox.minLat, lte: bbox.maxLat };
      homeConditions.lng = { gte: bbox.minLng, lte: bbox.maxLng };
    }

    matchLogger.debug(
      `Seeker ${seeker.id}: SQL filter - rent:[${search.minRent ?? 'null'},${search.maxRent ?? 'null'}], ` +
      `surface:[${search.minRoomSurface ?? 'null'},${search.maxRoomSurface ?? 'null'}], ` +
      `rooms:[${search.minRoomNb ?? 'null'},${search.maxRoomNb ?? 'null'}], ` +
      `homeTypes:${JSON.stringify(search.homeType)}, ` +
      `bbox:${bbox ? `[${bbox.minLat.toFixed(2)},${bbox.maxLat.toFixed(2)}]x[${bbox.minLng.toFixed(2)},${bbox.maxLng.toFixed(2)}]` : 'none'}`,
    );

    // Fetch candidate intents with their data
    const candidates = await this.prisma.intent.findMany({
      where: {
        isInFlow: true,
        totalMatchesRemaining: { gt: 0 },
        homeId: { not: null },
        searchId: { not: null },
        userId: { not: seeker.userId },
        home: homeConditions,
      },
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
      },
      take: this.matchingConfig.candidateLimit, // Configurable limit to prevent memory issues
    });

    const mapped: FullIntentData[] = [];
    for (const i of candidates) {
      if (!i.home || !i.search || !i.homeId || !i.searchId) {
        continue;
      }

      const home = i.home;
      if (
        home.lat === null ||
        home.lng === null ||
        home.rent === null ||
        home.surface === null ||
        home.nbRooms === null ||
        home.homeType === null
      ) {
        continue;
      }

      mapped.push({
        id: i.id,
        userId: i.userId,
        isInFlow: i.isInFlow,
        totalMatchesRemaining: i.totalMatchesRemaining,
        homeId: i.homeId,
        searchId: i.searchId,
        home: {
          id: home.id,
          userId: home.userId,
          lat: home.lat,
          lng: home.lng,
          rent: home.rent,
          surface: home.surface,
          nbRooms: home.nbRooms,
          homeType: home.homeType,
          addressFormatted: home.addressFormatted ?? null,
        },
        search: {
          ...i.search,
          homeType: i.search.homeType as HomeType[] | null,
        },
        zones: i.search.searchAdresses,
      });
    }

    return mapped;
  }

  private async logEligibilityCounts(matchLogger: MatchLogger): Promise<void> {
    const [eligibleCount, missingLinksCount] = await Promise.all([
      this.prisma.intent.count({
        where: {
          isInFlow: true,
          totalMatchesRemaining: { gt: 0 },
          homeId: { not: null },
          searchId: { not: null },
        },
      }),
      this.prisma.intent.count({
        where: {
          isInFlow: true,
          totalMatchesRemaining: { gt: 0 },
          OR: [{ homeId: null }, { searchId: null }],
        },
      }),
    ]);

    matchLogger.info(`Eligible intents count = ${eligibleCount}`);
    if (missingLinksCount > 0) {
      matchLogger.warn(
        `In-flow intents missing links (homeId/searchId) = ${missingLinksCount} - these will not be processed`,
      );
    }
  }

  private async repairMissingIntentLinks(
    matchLogger: MatchLogger,
  ): Promise<void> {
    const brokenIntents = await this.prisma.intent.findMany({
      where: {
        isInFlow: true,
        totalMatchesRemaining: { gt: 0 },
        OR: [{ homeId: null }, { searchId: null }],
      },
      select: { id: true, userId: true, homeId: true, searchId: true },
      take: 200,
    });

    if (brokenIntents.length === 0) return;

    for (const intent of brokenIntents) {
      await this.prisma.$transaction(async (tx) => {
        let homeId = intent.homeId;
        let searchId = intent.searchId;

        if (!homeId) {
          const home = await tx.home.findUnique({
            where: { userId: intent.userId },
            select: { id: true },
          });
          homeId = home?.id ?? null;
        }

        if (!searchId) {
          const search = await tx.search.findFirst({
            where: { userId: intent.userId },
            select: { id: true },
          });
          searchId = search?.id ?? null;
        }

        const stillMissing: string[] = [];
        if (!homeId) stillMissing.push('homeId');
        if (!searchId) stillMissing.push('searchId');

        await tx.intent.update({
          where: { id: intent.id },
          data: {
            homeId,
            searchId,
            isInFlow: stillMissing.length === 0,
          },
        });

        if (stillMissing.length === 0) {
          matchLogger.info(
            `Self-healed intent ${intent.id} for user ${intent.userId} (links restored)`,
          );
        } else {
          matchLogger.warn(
            `Intent ${intent.id} user ${intent.userId} removed from flow due to missing ${stillMissing.join(
              ' + ',
            )}`,
          );
        }
      });
    }
  }

  /**
   * Compute bounding box from zones for SQL pre-filtering
   */
  private computeBoundingBox(
    zones: ZoneData[],
  ): { minLat: number; maxLat: number; minLng: number; maxLng: number } | null {
    const validZones = zones.filter(
      (z) => z.latitude !== null && z.longitude !== null && z.radius !== null,
    );

    if (validZones.length === 0) return null;

    let minLat = Infinity;
    let maxLat = -Infinity;
    let minLng = Infinity;
    let maxLng = -Infinity;

    for (const zone of validZones) {
      const lat = zone.latitude!;
      const lng = zone.longitude!;
      // Convert radius (meters) to approx degrees + expansion margin
      const radiusDeg = (zone.radius! / 1000 / 111) + this.BBOX_EXPANSION_DEG;

      minLat = Math.min(minLat, lat - radiusDeg);
      maxLat = Math.max(maxLat, lat + radiusDeg);
      minLng = Math.min(minLng, lng - radiusDeg);
      maxLng = Math.max(maxLng, lng + radiusDeg);
    }

    return { minLat, maxLat, minLng, maxLng };
  }

  /**
   * Evaluate reciprocal match with DETAILED logging
   * Returns CheckResult with pass/fail and detailed reason
   */
  private evaluateReciprocalMatch(
    seeker: FullIntentData,
    target: FullIntentData,
    matchLogger: MatchLogger,
  ): CheckResult {
    const steps: StepLog[] = [];
    const logStep = (step: string, result: CheckResult) => {
      steps.push({
        step,
        passed: result.passed,
        reason: result.reason,
        details: result.details,
      });
      matchLogger.logTracedStep(
        seeker.userId,
        target.userId,
        seeker.id,
        target.id,
        step,
        result,
      );
      return result;
    };

    // STEP 1.1: Eligibility - Seeker
    let result = this.checkEligibility(seeker);
    logStep('1.1 ELIGIBILITY_SEEKER', result);
    if (!result.passed) {
      return {
        ...CheckResults.fail(
          `Seeker not eligible: ${result.reason}`,
          result.details,
        ),
        steps,
      };
    }

    // STEP 1.2: Eligibility - Target
    result = this.checkEligibility(target);
    logStep('1.2 ELIGIBILITY_TARGET', result);
    if (!result.passed) {
      return {
        ...CheckResults.fail(
          `Target not eligible: ${result.reason}`,
          result.details,
        ),
        steps,
      };
    }

    // STEP 2: Home(B) matches Search(A) criteria
    result = this.checkHomeMatchesSearch(
      target.home,
      seeker.search,
      'B_HOME_vs_A_SEARCH',
    );
    logStep('2.0 HOME_B_vs_SEARCH_A', result);
    if (!result.passed) {
      return { ...result, steps };
    }

    // STEP 3: Home(B) inside Search(A) zones
    result = this.checkHomeInZones(
      target.home,
      seeker.zones,
      'B_HOME_in_A_ZONES',
    );
    logStep('3.0 HOME_B_in_ZONES_A', result);
    if (!result.passed) {
      return { ...result, steps };
    }

    // STEP 4: Date overlap between Search(A) and Search(B)
    result = this.checkDateOverlap(seeker.search, target.search);
    logStep('4.0 DATE_OVERLAP', result);
    if (!result.passed) {
      return { ...result, steps };
    }

    // STEP 5: Home(A) matches Search(B) criteria (reciprocal)
    result = this.checkHomeMatchesSearch(
      seeker.home,
      target.search,
      'A_HOME_vs_B_SEARCH',
    );
    logStep('5.0 HOME_A_vs_SEARCH_B', result);
    if (!result.passed) {
      return { ...result, steps };
    }

    // STEP 6: Home(A) inside Search(B) zones (reciprocal)
    result = this.checkHomeInZones(
      seeker.home,
      target.zones,
      'A_HOME_in_B_ZONES',
    );
    logStep('6.0 HOME_A_in_ZONES_B', result);
    if (!result.passed) {
      return { ...result, steps };
    }

    // ALL CHECKS PASSED
    logStep(
      '7.0 RECIPROCAL_MATCH_CONFIRMED',
      CheckResults.pass('All reciprocal checks passed', {
        seekerIntentId: seeker.id,
        seekerUserId: seeker.userId,
        targetIntentId: target.id,
        targetUserId: target.userId,
      }),
    );

    return {
      ...CheckResults.pass('Reciprocal match confirmed', {
        seekerIntentId: seeker.id,
        targetIntentId: target.id,
      }),
      steps,
    };
  }

  /**
   * Check eligibility (isInFlow + credits)
   */
  private checkEligibility(intent: FullIntentData): CheckResult {
    if (!intent.isInFlow) {
      return CheckResults.fail('Not in flow', {
        intentId: intent.id,
        userId: intent.userId,
        isInFlow: false,
      });
    }
    if (intent.totalMatchesRemaining <= 0) {
      return CheckResults.fail('No credits remaining', {
        intentId: intent.id,
        userId: intent.userId,
        credits: intent.totalMatchesRemaining,
      });
    }
    return CheckResults.pass('Eligible', {
      intentId: intent.id,
      userId: intent.userId,
      isInFlow: true,
      credits: intent.totalMatchesRemaining,
    });
  }

  /**
   * Check if home matches search criteria with detailed result
   */
  private checkHomeMatchesSearch(
    home: HomeData,
    search: SearchData,
    context: string,
  ): CheckResult {
    // Rent check - min
    if (search.minRent !== null && home.rent < search.minRent) {
      return CheckResults.fail(`${context}: Rent below minimum`, {
        homeRent: home.rent,
        minRent: search.minRent,
        comparison: `${home.rent} < ${search.minRent}`,
      });
    }
    // Rent check - max
    if (search.maxRent !== null && home.rent > search.maxRent) {
      return CheckResults.fail(`${context}: Rent above maximum`, {
        homeRent: home.rent,
        maxRent: search.maxRent,
        comparison: `${home.rent} > ${search.maxRent}`,
      });
    }

    // Surface check - min
    if (
      search.minRoomSurface !== null &&
      home.surface < search.minRoomSurface
    ) {
      return CheckResults.fail(`${context}: Surface below minimum`, {
        homeSurface: home.surface,
        minSurface: search.minRoomSurface,
        comparison: `${home.surface} < ${search.minRoomSurface}`,
      });
    }
    // Surface check - max
    if (
      search.maxRoomSurface !== null &&
      home.surface > search.maxRoomSurface
    ) {
      return CheckResults.fail(`${context}: Surface above maximum`, {
        homeSurface: home.surface,
        maxSurface: search.maxRoomSurface,
        comparison: `${home.surface} > ${search.maxRoomSurface}`,
      });
    }

    // Rooms check - min
    if (search.minRoomNb !== null && home.nbRooms < search.minRoomNb) {
      return CheckResults.fail(`${context}: Rooms below minimum`, {
        homeRooms: home.nbRooms,
        minRooms: search.minRoomNb,
        comparison: `${home.nbRooms} < ${search.minRoomNb}`,
      });
    }
    // Rooms check - max
    if (search.maxRoomNb !== null && home.nbRooms > search.maxRoomNb) {
      return CheckResults.fail(`${context}: Rooms above maximum`, {
        homeRooms: home.nbRooms,
        maxRooms: search.maxRoomNb,
        comparison: `${home.nbRooms} > ${search.maxRoomNb}`,
      });
    }

    // HomeType check
    if (search.homeType && search.homeType.length > 0) {
      if (!search.homeType.includes(home.homeType)) {
        return CheckResults.fail(`${context}: HomeType not in allowed list`, {
          homeType: home.homeType,
          allowedTypes: search.homeType,
        });
      }
    }

    return CheckResults.pass(`${context}: All criteria match`, {
      rent: home.rent,
      rentRange: `[${search.minRent ?? 'null'},${search.maxRent ?? 'null'}]`,
      surface: home.surface,
      surfaceRange: `[${search.minRoomSurface ?? 'null'},${search.maxRoomSurface ?? 'null'}]`,
      rooms: home.nbRooms,
      roomsRange: `[${search.minRoomNb ?? 'null'},${search.maxRoomNb ?? 'null'}]`,
      homeType: home.homeType,
      allowedTypes: search.homeType || 'any',
    });
  }

  /**
   * Check if home is within at least one zone with detailed result
   */
  private checkHomeInZones(
    home: HomeData,
    zones: ZoneData[],
    context: string,
  ): CheckResult {
    const validZones = zones.filter(
      (z) => z.latitude !== null && z.longitude !== null && z.radius !== null,
    );

    if (validZones.length === 0) {
      return CheckResults.pass(
        `${context}: No zones defined, any location accepted`,
        {
          zonesCount: 0,
          homeLat: home.lat,
          homeLng: home.lng,
        },
      );
    }

    const zoneChecks: ZoneCheckDetail[] = [];

    for (const zone of validZones) {
      const distance = this.haversineDistance(
        home.lat,
        home.lng,
        zone.latitude!,
        zone.longitude!,
      );

      const passed = distance <= zone.radius!;

      zoneChecks.push({
        zoneLabel: zone.label,
        zoneLat: zone.latitude!,
        zoneLng: zone.longitude!,
        zoneRadius: zone.radius!,
        homeLat: home.lat,
        homeLng: home.lng,
        distance: Math.round(distance),
        passed,
      });

      if (passed) {
        return CheckResults.pass(
          `${context}: Home within zone "${zone.label || 'unnamed'}"`,
          {
            matchedZone: zone.label || 'unnamed',
            distance: `${Math.round(distance)}m`,
            radius: `${zone.radius}m`,
            homeLat: home.lat,
            homeLng: home.lng,
            zoneLat: zone.latitude,
            zoneLng: zone.longitude,
            allZonesChecked: zoneChecks,
          },
        );
      }
    }

    // No zone matched
    const closestZone = zoneChecks.reduce((a, b) =>
      a.distance < b.distance ? a : b,
    );
    return CheckResults.fail(`${context}: Home not within any zone`, {
      zonesChecked: validZones.length,
      closestZone: closestZone.zoneLabel || 'unnamed',
      closestDistance: `${closestZone.distance}m`,
      closestRadius: `${closestZone.zoneRadius}m`,
      gap: `${closestZone.distance - closestZone.zoneRadius}m outside`,
      homeLat: home.lat,
      homeLng: home.lng,
      allZonesChecked: zoneChecks,
    });
  }

  /**
   * Check date overlap with 10% tolerance - detailed result
   */
  private checkDateOverlap(
    searchA: SearchData,
    searchB: SearchData,
  ): CheckResult {
    const now = new Date();
    const farFuture = new Date(now.getTime() + 10 * 365 * 24 * 60 * 60 * 1000);

    // Parse dates with defaults
    const startA = searchA.searchStartDate ?? now;
    const endA = searchA.searchEndDate ?? farFuture;
    const startB = searchB.searchStartDate ?? now;
    const endB = searchB.searchEndDate ?? farFuture;

    // Calculate tolerance
    // const toleranceA = this.calculateToleranceDays(startA, endA);
    // const toleranceB = this.calculateToleranceDays(startB, endB);

    const toleranceA = 0;
    const toleranceB = 0;

    // Expand windows
    const expandedStartA = new Date(
      startA.getTime() - toleranceA * 24 * 60 * 60 * 1000,
    );
    const expandedEndA = new Date(
      endA.getTime() + toleranceA * 24 * 60 * 60 * 1000,
    );
    const expandedStartB = new Date(
      startB.getTime() - toleranceB * 24 * 60 * 60 * 1000,
    );
    const expandedEndB = new Date(
      endB.getTime() + toleranceB * 24 * 60 * 60 * 1000,
    );

    // Check intersection
    const hasIntersection =
      expandedStartA <= expandedEndB && expandedStartB <= expandedEndA;

    const details = {
      searchAStart: startA.toISOString().slice(0, 10),
      searchAEnd: endA.toISOString().slice(0, 10),
      searchBStart: startB.toISOString().slice(0, 10),
      searchBEnd: endB.toISOString().slice(0, 10),
      toleranceADays: Math.round(toleranceA),
      toleranceBDays: Math.round(toleranceB),
      expandedAStart: expandedStartA.toISOString().slice(0, 10),
      expandedAEnd: expandedEndA.toISOString().slice(0, 10),
      expandedBStart: expandedStartB.toISOString().slice(0, 10),
      expandedBEnd: expandedEndB.toISOString().slice(0, 10),
    };

    if (hasIntersection) {
      return CheckResults.pass(
        'Date windows overlap (with tolerance)',
        details,
      );
    }

    return CheckResults.fail('Date windows do not overlap', {
      ...details,
      reason:
        expandedEndA < expandedStartB
          ? `A ends (${expandedEndA.toISOString().slice(0, 10)}) before B starts (${expandedStartB.toISOString().slice(0, 10)})`
          : `B ends (${expandedEndB.toISOString().slice(0, 10)}) before A starts (${expandedStartA.toISOString().slice(0, 10)})`,
    });
  }

  /**
   * Calculate tolerance in days: 10% of interval duration, minimum 1 day
   */
  private calculateToleranceDays(start: Date, end: Date): number {
    const durationMs = end.getTime() - start.getTime();
    const durationDays = durationMs / (24 * 60 * 60 * 1000);
    const toleranceDays = durationDays * this.DATE_OVERLAP_TOLERANCE;
    return Math.max(toleranceDays, this.MIN_TOLERANCE_DAYS);
  }

  /**
   * Calculate distance between two points using Haversine formula
   * Returns distance in meters
   */
  private haversineDistance(
    lat1: number,
    lng1: number,
    lat2: number,
    lng2: number,
  ): number {
    const toRad = (deg: number) => (deg * Math.PI) / 180;

    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return this.EARTH_RADIUS_M * c;
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

  private async consumePaymentCredit(
    tx: Prisma.TransactionClient,
    userId: number,
    intentId: number,
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

    throw new Error('INSUFFICIENT_PAYMENT_CREDITS');
  }

  /**
   * Create reciprocal match in a SINGLE transaction
   * Also writes outbox events for BOTH participants for email notification
   */
  private async createReciprocalMatchTransaction(
    seeker: FullIntentData,
    target: FullIntentData,
    evaluation: CheckResult,
    matchLogger: MatchLogger,
    stats: MatchingRunStats,
  ): Promise<boolean> {
    matchLogger.logTransaction(seeker.id, target.id, 'START', {
      seekerUserId: seeker.userId,
      targetUserId: target.userId,
      seekerCredits: seeker.totalMatchesRemaining,
      targetCredits: target.totalMatchesRemaining,
    });

    try {
      const runId = matchLogger.getRunId();
      const snapshot = this.buildMatchSnapshot(
        runId,
        seeker,
        target,
        evaluation.steps || [],
      );

      const result = await this.prisma.$transaction(async (tx) => {
        // Re-verify both still have credits
        const [freshSeeker, freshTarget] = await Promise.all([
          tx.intent.findUnique({
            where: { id: seeker.id },
            select: { totalMatchesRemaining: true, isInFlow: true },
          }),
          tx.intent.findUnique({
            where: { id: target.id },
            select: { totalMatchesRemaining: true, isInFlow: true },
          }),
        ]);

        if (
          !freshSeeker?.isInFlow ||
          !freshTarget?.isInFlow ||
          (freshSeeker.totalMatchesRemaining ?? 0) <= 0 ||
          (freshTarget.totalMatchesRemaining ?? 0) <= 0
        ) {
          throw new Error('INSUFFICIENT_CREDITS');
        }

        // Check for existing matches (duplicate prevention)
        const existingMatch = await tx.match.findFirst({
          where: {
            OR: [
              { seekerIntentId: seeker.id, targetHomeId: target.homeId },
              { seekerIntentId: target.id, targetHomeId: seeker.homeId },
            ],
          },
        });

        if (existingMatch) {
          throw new Error('DUPLICATE_MATCH');
        }

        const groupId = uuidv4();

        // Consume one payment credit per user (FIFO)
        await this.consumePaymentCredit(tx, seeker.userId, seeker.id);
        await this.consumePaymentCredit(tx, target.userId, target.id);

        // Create match for seeker (sees target's home)
        const matchForSeeker = await tx.match.create({
          data: {
            seekerIntentId: seeker.id,
            targetIntentId: target.id,
            targetHomeId: target.homeId,
            status: MatchStatus.NEW,
            groupId,
            snapshot,
            snapshotVersion: this.SNAPSHOT_VERSION,
          },
        });

        // Create match for target (sees seeker's home)
        const matchForTarget = await tx.match.create({
          data: {
            seekerIntentId: target.id,
            targetIntentId: seeker.id,
            targetHomeId: seeker.homeId,
            status: MatchStatus.NEW,
            groupId,
            snapshot,
            snapshotVersion: this.SNAPSHOT_VERSION,
          },
        });

        // Consume credits for seeker
        const newSeekerCredits = (freshSeeker.totalMatchesRemaining ?? 0) - 1;
        await tx.intent.update({
          where: { id: seeker.id },
          data: {
            totalMatchesRemaining: newSeekerCredits,
            totalMatchesUsed: { increment: 1 },
            isInFlow: newSeekerCredits > 0,
          },
        });

        // Consume credits for target
        const newTargetCredits = (freshTarget.totalMatchesRemaining ?? 0) - 1;
        await tx.intent.update({
          where: { id: target.id },
          data: {
            totalMatchesRemaining: newTargetCredits,
            totalMatchesUsed: { increment: 1 },
            isInFlow: newTargetCredits > 0,
          },
        });

        // Track users removed from flow
        if (newSeekerCredits <= 0) stats.usersRemovedFromFlow++;
        if (newTargetCredits <= 0) stats.usersRemovedFromFlow++;

        // Write outbox events for BOTH participants (atomic with match creation)
        // Each user sees "1 new match" even though 2 Match rows were created
        await this.notificationOutboxService.writeStandardMatchOutbox(
          tx,
          runId,
          { intentId: seeker.id, userId: seeker.userId },
          { intentId: target.id, userId: target.userId },
          { seeker: matchForSeeker.uid, target: matchForTarget.uid },
        );

        return {
          matchForSeeker,
          matchForTarget,
          newSeekerCredits,
          newTargetCredits,
        };
      });

      matchLogger.logTransaction(seeker.id, target.id, 'COMMIT', {
        seekerCreditsAfter: result.newSeekerCredits,
        targetCreditsAfter: result.newTargetCredits,
        matchIdForSeeker: result.matchForSeeker.id,
        matchIdForTarget: result.matchForTarget.id,
      });

      matchLogger.logMatchCreated(
        seeker.id,
        target.id,
        target.homeId,
        result.matchForSeeker.id,
      );
      matchLogger.logMatchCreated(
        target.id,
        seeker.id,
        seeker.homeId,
        result.matchForTarget.id,
      );

      // Update local state for further iterations
      seeker.totalMatchesRemaining = result.newSeekerCredits;
      seeker.isInFlow = result.newSeekerCredits > 0;

      return true;
    } catch (error: any) {
      if (error.code === 'P2002') {
        matchLogger.logTransaction(seeker.id, target.id, 'ROLLBACK', {
          reason: 'Duplicate prevented by DB constraint',
        });
        return false;
      }

      if (error.message === 'INSUFFICIENT_CREDITS') {
        matchLogger.logTransaction(seeker.id, target.id, 'ROLLBACK', {
          reason: 'Insufficient credits at transaction time',
        });
        return false;
      }

      if (error.message === 'DUPLICATE_MATCH') {
        matchLogger.logTransaction(seeker.id, target.id, 'ROLLBACK', {
          reason: 'Match already exists',
        });
        return false;
      }

      if (error.message === 'INSUFFICIENT_PAYMENT_CREDITS') {
        matchLogger.logTransaction(seeker.id, target.id, 'ROLLBACK', {
          reason: 'No payment credits available',
        });
        return false;
      }

      matchLogger.error(`Failed to create match: ${error.message}`, error);
      matchLogger.logTransaction(seeker.id, target.id, 'ROLLBACK', {
        reason: error.message,
      });
      return false;
    }
  }

  private buildMatchSnapshot(
    runId: string,
    seeker: FullIntentData,
    target: FullIntentData,
    steps: StepLog[],
  ): any {
    return {
      algorithmVersion: this.ALGORITHM_VERSION,
      snapshotVersion: this.SNAPSHOT_VERSION,
      runId,
      createdAt: new Date().toISOString(),
      seekerIntentId: seeker.id,
      seekerUserId: seeker.userId,
      targetIntentId: target.id,
      targetUserId: target.userId,
      seekerHome: this.mapHomeSnapshot(seeker.home),
      targetHome: this.mapHomeSnapshot(target.home),
      seekerSearch: this.mapSearchSnapshot(seeker.search),
      targetSearch: this.mapSearchSnapshot(target.search),
      seekerZones: this.mapZonesSnapshot(seeker.zones),
      targetZones: this.mapZonesSnapshot(target.zones),
      evaluation: this.buildEvaluationSummary(steps),
    };
  }

  private mapHomeSnapshot(home: HomeData) {
    return {
      id: home.id,
      lat: home.lat,
      lng: home.lng,
      rent: home.rent,
      surface: home.surface,
      nbRooms: home.nbRooms,
      homeType: home.homeType,
      addressFormatted: home.addressFormatted ?? undefined,
    };
  }

  private mapSearchSnapshot(search: SearchData) {
    return {
      minRent: search.minRent,
      maxRent: search.maxRent,
      minSurface: search.minRoomSurface,
      maxSurface: search.maxRoomSurface,
      minRooms: search.minRoomNb,
      maxRooms: search.maxRoomNb,
      homeTypes: search.homeType,
      searchStartDate: search.searchStartDate
        ? search.searchStartDate.toISOString()
        : null,
      searchEndDate: search.searchEndDate
        ? search.searchEndDate.toISOString()
        : null,
    };
  }

  private mapZonesSnapshot(zones: ZoneData[]) {
    return zones.map((zone) => ({
      lat: zone.latitude,
      lng: zone.longitude,
      radius: zone.radius,
      label: zone.label,
    }));
  }

  private buildEvaluationSummary(steps: StepLog[]) {
    const findStep = (prefix: string) =>
      steps.find((s) => s.step.startsWith(prefix));

    const dateStep = findStep('4.0');
    const targetHomeInSeekerZones = findStep('3.0');
    const seekerHomeInTargetZones = findStep('6.0');

    return {
      dateOverlap: {
        passed: dateStep?.passed ?? false,
        details: dateStep?.details || undefined,
      },
      geo: {
        targetHomeInSeekerZones: targetHomeInSeekerZones
          ? {
            passed: targetHomeInSeekerZones.passed,
            details: targetHomeInSeekerZones.details,
          }
          : undefined,
        seekerHomeInTargetZones: seekerHomeInTargetZones
          ? {
            passed: seekerHomeInTargetZones.passed,
            details: seekerHomeInTargetZones.details,
          }
          : undefined,
      },
      reasons: steps.map((s) => `${s.step}: ${s.reason}`),
    };
  }

  /**
   * Run matching algorithm for a single intent (called by MatchingWorkerService)
   * This method processes one intent at a time for distributed queue processing.
   *
   * @param intentId - The intent ID to process
   * @param runId - Unique run identifier for logging
   * @returns Number of matches created (2 per reciprocal match)
   */
  async matchForIntent(intentId: number, runId: string): Promise<number> {
    const matchLogger = new MatchLogger();
    matchLogger.info(
      `[MatchForIntent] Starting matching for intent ${intentId} (runId=${runId})`,
    );

    // Fetch the intent with full data
    const seeker = await this.fetchSingleIntentWithFullData(intentId);

    if (!seeker) {
      matchLogger.warn(
        `[MatchForIntent] Intent ${intentId} not found or not eligible`,
      );
      return 0;
    }

    if (seeker.totalMatchesRemaining <= 0 || !seeker.isInFlow) {
      matchLogger.info(
        `[MatchForIntent] Intent ${intentId} has no credits or not in flow`,
      );
      return 0;
    }

    const stats: MatchingRunStats = {
      seekersProcessed: 0,
      candidatesConsidered: 0,
      matchesCreated: 0,
      triangleMatchesCreated: 0,
      usersRemovedFromFlow: 0,
    };

    // Fetch existing matches for this seeker
    const existingMatchesMap = await this.fetchExistingMatchesMap([seeker.id]);
    const existingMatchedHomeIds =
      existingMatchesMap.get(seeker.id) || new Set();

    // Process STANDARD matches
    const matchesCreated = await this.processSeeker(
      seeker,
      existingMatchedHomeIds,
      matchLogger,
      stats,
    );

    stats.matchesCreated += matchesCreated;
    stats.seekersProcessed++;

    // Try TRIANGLE matches if enabled and credits remain
    if (this.triangleEnabled) {
      const remainingCredits = await this.getIntentCredits(seeker.id);
      if (remainingCredits > 0) {
        matchLogger.debug(
          `[MatchForIntent] ${remainingCredits} credits left, trying TRIANGLE matching`,
        );

        const trianglesCreated =
          await this.triangleMatchingService.findAndCreateTriangles(
            seeker.id,
            Math.min(remainingCredits, this.MAX_TRIANGLES_PER_SEEKER),
            matchLogger,
          );

        if (trianglesCreated > 0) {
          stats.triangleMatchesCreated += trianglesCreated * 3;
          matchLogger.info(
            `[MatchForIntent] Created ${trianglesCreated} triangle(s) (${trianglesCreated * 3} Match rows)`,
          );
        }
      }
    }

    const totalMatches = stats.matchesCreated + stats.triangleMatchesCreated;
    matchLogger.info(
      `[MatchForIntent] Completed for intent ${intentId}: ${totalMatches} matches created`,
    );

    return totalMatches;
  }

  /**
   * Fetch a single intent with full data for matching
   */
  private async fetchSingleIntentWithFullData(
    intentId: number,
  ): Promise<FullIntentData | null> {
    const intent = await this.prisma.intent.findFirst({
      where: {
        id: intentId,
        isInFlow: true,
        totalMatchesRemaining: { gt: 0 },
        homeId: { not: null },
        searchId: { not: null },
      },
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
        addressFormatted: home.addressFormatted ?? null,
      },
      search: {
        ...intent.search,
        homeType: intent.search.homeType as HomeType[] | null,
      },
      zones: intent.search.searchAdresses,
    };
  }
}
