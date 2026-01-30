import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  Req,
  HttpException,
  HttpStatus,
  ParseIntPipe,
  Logger,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PrismaService } from '../../prisma/prisma.service';
import { MatchStatus, MatchType } from '@prisma/client';
import {
  GetMatchesQueryDto,
  UpdateMatchStatusDto,
  MatchFilterStatus,
  MatchSortOrder,
  MatchStatusDto,
  MatchTypeDto,
  MatchItemDto,
  MatchListResponseDto,
  MatchStatusSummaryDto,
  UpdateMatchStatusResponseDto,
  HomeInfoDto,
  MatchItemDetailsDto,
  TriangleMetaDto,
  MatchMarkSeenResponseDto,
} from '../dto/match.dto';
import { S3Service } from '../../home/services/s3.service';

interface AuthenticatedRequest {
  user: { userId: number };
}

/**
 * MatchListController
 *
 * Handles API endpoints for match list operations:
 * - GET /matching/matches - List matches for current user
 * - GET /matching/match-status - Get match status summary
 *
 * PREFERRED ENDPOINTS (use UID for anti-enumeration):
 * - GET /matching/matches/uid/:uid - Get match details by UID
 * - PATCH /matching/matches/uid/:uid/status - Update match status by UID
 *
 * LEGACY ENDPOINTS (kept for backward compatibility):
 * - GET /matching/matches/:id - Get match details by ID
 * - PATCH /matching/matches/:id/status - Update match status by ID
 *
 * NOTE: Frontend should exclusively use UID-based endpoints.
 * ID-based endpoints are deprecated and may be removed in future versions.
 */
@Controller('matching')
@UseGuards(AuthGuard('jwt'))
export class MatchListController {
  private readonly logger = new Logger(MatchListController.name);
  private readonly ACTIVE_STATUSES: MatchStatus[] = [
    MatchStatus.NEW,
    MatchStatus.IN_PROGRESS,
    MatchStatus.NOT_INTERESTED,
  ];

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3Service: S3Service,
  ) {}

  /**
   * GET /matching/matches
   *
   * Returns paginated list of matches for current user (seeker perspective)
   * Supports filtering by status, sorting, and pagination
   */
  @Get('matches')
  async getMatches(
    @Req() req: AuthenticatedRequest,
    @Query() query: GetMatchesQueryDto,
  ): Promise<MatchListResponseDto> {
    const userId = req.user.userId;

    // Get user's intent
    const intent = await this.prisma.intent.findFirst({
      where: { userId },
      select: { id: true },
    });

    if (!intent) {
      return {
        items: [],
        pagination: {
          page: query.page || 1,
          pageSize: query.pageSize || 10,
          totalItems: 0,
          totalPages: 0,
          hasMore: false,
        },
        maxCreatedAt: null,
      };
    }

    // Parse optional "since" param (ISO string)
    let sinceDate: Date | null = null;
    if (query.since) {
      const parsed = new Date(query.since);
      if (!Number.isNaN(parsed.getTime())) {
        const now = new Date();
        const minDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        if (parsed > now) {
          sinceDate = now;
        } else if (parsed < minDate) {
          sinceDate = minDate;
        } else {
          sinceDate = parsed;
        }
      }
    }

    // Build where clause
    const whereClause: any = {
      seekerIntentId: intent.id,
    };

    // Status filter (ALL = all active, ARCHIVED = only archived)
    const statusFilter = query.status || MatchFilterStatus.ALL;
    if (statusFilter === MatchFilterStatus.ARCHIVED) {
      whereClause.status = { notIn: this.ACTIVE_STATUSES };
    } else if (statusFilter === MatchFilterStatus.ALL) {
      whereClause.status = { in: this.ACTIVE_STATUSES };
    } else {
      whereClause.status = statusFilter as unknown as MatchStatus;
    }

    if (sinceDate) {
      whereClause.createdAt = { gt: sinceDate };
    }

    // Count total
    const totalItems = await this.prisma.match.count({ where: whereClause });

    // Calculate pagination
    const page = query.page || 1;
    const pageSize = query.pageSize || 10;
    const totalPages = Math.ceil(totalItems / pageSize);
    const skip = (page - 1) * pageSize;

    // Sort order
    const orderBy: any = {
      createdAt: query.sort === MatchSortOrder.OLDEST ? 'asc' : 'desc',
    };

    // Fetch matches with target home data + type/groupId for triangle support
    // IMPORTANT: Use select instead of include to ensure we get type, groupId, and uid
    const matches = (await this.prisma.match.findMany({
      where: whereClause,
      orderBy,
      skip,
      take: pageSize,
      select: {
        id: true,
        uid: true, // Public identifier for URLs
        status: true,
        type: true, // CRITICAL: Must include to distinguish STANDARD vs TRIANGLE
        groupId: true, // CRITICAL: Must include for triangle grouping
        createdAt: true,
        updatedAt: true,
        snapshot: true, // Needed for triangle metadata
        targetHome: {
          select: {
            id: true,
            rent: true,
            surface: true,
            nbRooms: true,
            homeType: true,
            addressFormatted: true,
            description: true,
            images: {
              select: { url: true },
              orderBy: { order: 'asc' },
            },
          },
        },
        targetIntent: {
          select: {
            user: {
              select: {
                firstName: true,
              },
            },
          },
        },
      },
    })) as any[]; // Cast needed until Prisma client is regenerated with new fields

    // Transform to DTOs
    const items: MatchItemDto[] = await Promise.all(
      matches.map(async (match) => {
        const imageUrls =
          match.targetHome.images && match.targetHome.images.length > 0
            ? await Promise.all(
                match.targetHome.images.map((img: { url: string }) =>
                  this.s3Service.getPublicUrl(img.url),
                ),
              )
            : [];
        this.logger.debug(
          `[MatchList] targetHome=${match.targetHome.id} images=${imageUrls.length}`,
        );

        // Extract match type from DB - NEVER use fallback to STANDARD!
        // The type field is required in the DB, so it should always be present.
        let matchType: MatchTypeDto = match.type as MatchTypeDto;
        if (!matchType) {
          this.logger.warn(
            `Match ${match.id} has null type in DB! Falling back to snapshot.matchType`,
          );
          matchType = (match.snapshot?.matchType || 'STANDARD') as MatchTypeDto;
        }

        // Extract triangle metadata from snapshot if TRIANGLE type
        const triangleMeta: TriangleMetaDto | undefined =
          matchType === MatchTypeDto.TRIANGLE && match.snapshot?.participants
            ? {
                groupId: match.groupId || match.snapshot?.groupId,
                participants: match.snapshot.participants,
                chain: match.snapshot.chain || [],
              }
            : undefined;

        return {
          id: match.id,
          uid: match.uid, // Public identifier for URLs
          status: match.status as unknown as MatchStatusDto,
          type: matchType, // Use DB value, not fallback
          groupId: match.groupId || undefined,
          createdAt: match.createdAt.toISOString(),
          updatedAt: match.updatedAt.toISOString(),
          targetHome: {
            id: match.targetHome.id,
            rent: match.targetHome.rent,
            surface: match.targetHome.surface,
            nbRooms: match.targetHome.nbRooms,
            homeType: match.targetHome.homeType,
            addressFormatted: match.targetHome.addressFormatted,
            description: match.targetHome.description || undefined,
            imageUrls,
            imageUrl: imageUrls[0],
          },
          targetUserFirstName: match.targetIntent.user.firstName,
          triangleMeta,
        };
      }),
    );

    // Build cursor for infinite scroll
    const lastItem = matches[matches.length - 1];
    const nextCursor = lastItem
      ? Buffer.from(
          JSON.stringify({
            createdAt: lastItem.createdAt.toISOString(),
            id: lastItem.id,
          }),
        ).toString('base64')
      : undefined;

    let maxCreatedAt: Date | null = null;
    for (const match of matches) {
      if (!maxCreatedAt || match.createdAt > maxCreatedAt) {
        maxCreatedAt = match.createdAt;
      }
    }

    return {
      items,
      pagination: {
        page,
        pageSize,
        totalItems,
        totalPages,
        hasMore: page < totalPages,
      },
      nextCursor,
      maxCreatedAt: maxCreatedAt ? maxCreatedAt.toISOString() : null,
    };
  }

  /**
   * GET /matching/status
   *
   * Returns match status summary for current user
   */
  @Get('match-status')
  async getMatchStatus(
    @Req() req: AuthenticatedRequest,
  ): Promise<MatchStatusSummaryDto> {
    const userId = req.user.userId;
    const serverNow = new Date();

    // Get user's intent with credit info
    const intent = await this.prisma.intent.findFirst({
      where: { userId },
      select: {
        id: true,
        isInFlow: true,
        totalMatchesPurchased: true,
        totalMatchesUsed: true,
        totalMatchesRemaining: true,
        lastMatchesSeenAt: true,
      },
    });

    if (!intent) {
      return {
        isInFlow: false,
        totalMatchesPurchased: 0,
        totalMatchesUsed: 0,
        totalMatchesRemaining: 0,
        totalMatches: 0,
        newMatches: 0,
        inProgressMatches: 0,
        lastMatchesSeenAt: null,
        serverNow: serverNow.toISOString(),
      };
    }

    const lastMatchesSeenAt = intent.lastMatchesSeenAt;

    // Count matches by status
    const [totalMatches, newMatches, inProgressMatches] = await Promise.all([
      this.prisma.match.count({
        where: {
          seekerIntentId: intent.id,
          status: { in: this.ACTIVE_STATUSES },
        },
      }),
      this.prisma.match.count({
        where: {
          seekerIntentId: intent.id,
          status: { in: this.ACTIVE_STATUSES },
          ...(lastMatchesSeenAt
            ? { createdAt: { gt: lastMatchesSeenAt } }
            : {}),
        },
      }),
      this.prisma.match.count({
        where: { seekerIntentId: intent.id, status: MatchStatus.IN_PROGRESS },
      }),
    ]);

    return {
      isInFlow: intent.isInFlow,
      totalMatchesPurchased: intent.totalMatchesPurchased,
      totalMatchesUsed: intent.totalMatchesUsed,
      totalMatchesRemaining: intent.totalMatchesRemaining,
      totalMatches,
      newMatches,
      inProgressMatches,
      lastMatchesSeenAt: lastMatchesSeenAt
        ? lastMatchesSeenAt.toISOString()
        : null,
      serverNow: serverNow.toISOString(),
    };
  }

  /**
   * POST /matching/matches/mark-seen
   *
   * Marks matches as seen by updating intent.lastMatchesSeenAt
   */
  @Post('matches/mark-seen')
  async markMatchesSeen(
    @Req() req: AuthenticatedRequest,
  ): Promise<MatchMarkSeenResponseDto> {
    const userId = req.user.userId;
    const intent = await this.prisma.intent.findFirst({
      where: { userId },
      select: { id: true },
    });

    if (!intent) {
      return { success: false, lastMatchesSeenAt: null };
    }

    const now = new Date();
    await this.prisma.intent.update({
      where: { id: intent.id },
      data: { lastMatchesSeenAt: now },
    });

    return { success: true, lastMatchesSeenAt: now.toISOString() };
  }

  /**
   * PATCH /matching/matches/:id/status
   *
   * @deprecated Use PATCH /matching/matches/uid/:uid/status instead
   *
   * Update match status (legacy endpoint using auto-increment ID).
   * Frontend should use UID-based endpoint for anti-enumeration.
   *
   * Allowed transitions:
   * - NEW -> IN_PROGRESS
   * - NEW -> NOT_INTERESTED
   * - IN_PROGRESS -> NOT_INTERESTED
   * - IN_PROGRESS -> NEW (reset)
   * - NOT_INTERESTED -> NEW (undo)
   *
   * Forbidden (returns 409 Conflict):
   * - Any status -> same status (no-op)
   */
  @Patch('matches/:id/status')
  async updateMatchStatus(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) matchId: number,
    @Body() body: UpdateMatchStatusDto,
  ): Promise<UpdateMatchStatusResponseDto> {
    const userId = req.user.userId;

    // Get user's intent
    const intent = await this.prisma.intent.findFirst({
      where: { userId },
      select: { id: true },
    });

    if (!intent) {
      throw new HttpException('Intent not found', HttpStatus.NOT_FOUND);
    }

    // Find the match
    const match = await this.prisma.match.findFirst({
      where: {
        id: matchId,
        seekerIntentId: intent.id,
      },
    });

    if (!match) {
      throw new HttpException('Match not found', HttpStatus.NOT_FOUND);
    }

    // Validate status transition
    const currentStatus = match.status;
    const newStatus = body.status as unknown as MatchStatus;

    const transitionResult = this.isValidTransition(currentStatus, newStatus);

    if (transitionResult === 'CONFLICT') {
      this.logger.warn(
        `Match ${matchId}: attempted no-op transition ${currentStatus} -> ${newStatus}`,
      );
      throw new HttpException(
        `Le match est déjà dans le statut ${currentStatus}`,
        HttpStatus.CONFLICT,
      );
    }

    if (!transitionResult) {
      throw new HttpException(
        `Invalid status transition from ${currentStatus} to ${newStatus}`,
        HttpStatus.BAD_REQUEST,
      );
    }

    // Update the match
    const updated = await this.prisma.match.update({
      where: { id: matchId },
      data: { status: newStatus },
    });

    this.logger.log(
      `Match ${matchId} status updated: ${currentStatus} -> ${newStatus}`,
    );

    return {
      id: updated.id,
      status: updated.status as unknown as MatchStatusDto,
      updatedAt: updated.updatedAt.toISOString(),
    };
  }

  /**
   * GET /matching/matches/:id
   *
   * @deprecated Use GET /matching/matches/uid/:uid instead
   *
   * Returns details of a specific match for the current user (legacy endpoint).
   * Frontend should use UID-based endpoint for anti-enumeration.
   * Enforces strict ownership check (seekerIntent.userId === currentUserId)
   */
  @Get('matches/:id')
  async getMatchDetails(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) matchId: number,
  ): Promise<MatchItemDetailsDto> {
    const userId = req.user.userId;

    // Strict ownership check & optimized payload selection
    // IMPORTANT: Always include 'type' and 'groupId' to correctly identify TRIANGLE matches
    // BUG FIX: Previously these fields were missing, causing TRIANGLE matches to appear as STANDARD
    const match = (await this.prisma.match.findFirst({
      where: {
        id: matchId,
        seekerIntent: {
          userId: userId, // Direct ownership check
        },
      },
      select: {
        id: true,
        uid: true, // Public identifier for URLs
        status: true,
        type: true, // CRITICAL: Must include to distinguish STANDARD vs TRIANGLE
        groupId: true, // CRITICAL: Must include for triangle grouping
        createdAt: true,
        updatedAt: true,
        snapshot: true,
        snapshotVersion: true,
        seekerIntentId: true, // Needed for edge evaluation lookup
        targetIntentId: true, // Needed for edge evaluation lookup
        targetHome: {
          select: {
            id: true,
            rent: true,
            surface: true,
            nbRooms: true,
            homeType: true,
            addressFormatted: true,
            description: true,
            images: {
              select: { url: true },
              orderBy: { order: 'asc' },
            },
          },
        },
        targetIntent: {
          select: {
            user: {
              select: {
                firstName: true,
              },
            },
          },
        },
      },
    })) as any; // Cast needed until Prisma client is regenerated

    if (!match) {
      throw new HttpException('Match not found', HttpStatus.NOT_FOUND);
    }

    // Transform to DTO
    const imageUrls =
      match.targetHome.images && match.targetHome.images.length > 0
        ? await Promise.all(
            match.targetHome.images.map((img: { url: string }) =>
              this.s3Service.getPublicUrl(img.url),
            ),
          )
        : [];

    // Extract match type from DB - NEVER use fallback to STANDARD!
    // The type field is required in the DB, so it should always be present.
    // If somehow null, log a warning and fall back to snapshot.matchType
    let matchType: MatchTypeDto = match.type as MatchTypeDto;
    if (!matchType) {
      // This should never happen, but handle gracefully
      this.logger.warn(
        `Match ${match.id} has null type in DB! Falling back to snapshot.matchType`,
      );
      matchType = (match.snapshot?.matchType || 'STANDARD') as MatchTypeDto;
    }

    // Extract triangle metadata from snapshot if TRIANGLE type
    const triangleMeta: TriangleMetaDto | undefined =
      matchType === MatchTypeDto.TRIANGLE && match.snapshot?.participants
        ? {
            groupId: match.groupId || match.snapshot?.groupId,
            participants: match.snapshot.participants,
            chain: match.snapshot.chain || [],
          }
        : undefined;

    return {
      id: match.id,
      uid: match.uid, // Public identifier for URLs
      status: match.status as unknown as MatchStatusDto,
      type: matchType, // Use DB value, not fallback
      groupId: match.groupId || undefined,
      createdAt: match.createdAt.toISOString(),
      updatedAt: match.updatedAt.toISOString(),
      snapshot: match.snapshot,
      snapshotVersion: match.snapshotVersion,
      targetHome: {
        id: match.targetHome.id,
        rent: match.targetHome.rent,
        surface: match.targetHome.surface,
        nbRooms: match.targetHome.nbRooms,
        homeType: match.targetHome.homeType,
        addressFormatted: match.targetHome.addressFormatted,
        description: match.targetHome.description || undefined,
        imageUrls,
        imageUrl: imageUrls[0],
      },
      targetUserFirstName: match.targetIntent.user.firstName,
      triangleMeta,
      seekerIntentId: match.seekerIntentId,
      targetIntentId: match.targetIntentId,
    };
  }

  /**
   * Check if status transition is valid
   *
   * STRICT RULES:
   * - NEW -> IN_PROGRESS (user starts reviewing)
   * - NEW -> NOT_INTERESTED (user rejects immediately)
   * - IN_PROGRESS -> NOT_INTERESTED (user rejects after review)
   * - IN_PROGRESS -> NEW (user wants to reset)
   * - NOT_INTERESTED -> NEW (user wants to reconsider / UNDO)
   *
   * FORBIDDEN (returns 'CONFLICT' string):
   * - Same status -> Same status (no-op, idempotent but useless)
   *
   * @returns true if valid, 'CONFLICT' if same status, false if invalid transition
   */
  private isValidTransition(
    current: MatchStatus,
    next: MatchStatus,
  ): boolean | 'CONFLICT' {
    // Archived matches are immutable via API
    if (
      (current as unknown as string) === 'ARCHIVED' ||
      (next as unknown as string) === 'ARCHIVED'
    ) {
      return false;
    }

    // Same status -> same status is a conflict (no-op)
    if (current === next) {
      return 'CONFLICT';
    }

    if (current === MatchStatus.NEW) {
      return (
        next === MatchStatus.IN_PROGRESS || next === MatchStatus.NOT_INTERESTED
      );
    }

    if (current === MatchStatus.IN_PROGRESS) {
      // Can go back to NEW or forward to NOT_INTERESTED
      return next === MatchStatus.NOT_INTERESTED || next === MatchStatus.NEW;
    }

    if (current === MatchStatus.NOT_INTERESTED) {
      // Allow returning to NEW (undo "not interested")
      return next === MatchStatus.NEW;
    }

    return false;
  }

  /**
   * GET /matching/matches/uid/:uid
   *
   * Returns details of a specific match by UID (public identifier)
   * This is the preferred endpoint for frontend - uses UID instead of auto-increment ID
   */
  @Get('matches/uid/:uid')
  async getMatchDetailsByUid(
    @Req() req: AuthenticatedRequest,
    @Param('uid') uid: string,
  ): Promise<MatchItemDetailsDto> {
    const userId = req.user.userId;

    // Find match by UID with ownership check
    const match = (await this.prisma.match.findFirst({
      where: {
        uid,
        seekerIntent: {
          userId: userId,
        },
      },
      select: {
        id: true,
        uid: true,
        status: true,
        type: true,
        groupId: true,
        createdAt: true,
        updatedAt: true,
        snapshot: true,
        snapshotVersion: true,
        seekerIntentId: true, // Needed for edge evaluation lookup
        targetIntentId: true, // Needed for edge evaluation lookup
        targetHome: {
          select: {
            id: true,
            rent: true,
            surface: true,
            nbRooms: true,
            homeType: true,
            addressFormatted: true,
            description: true,
            images: {
              select: { url: true },
              orderBy: { order: 'asc' },
            },
          },
        },
        targetIntent: {
          select: {
            user: {
              select: {
                firstName: true,
              },
            },
          },
        },
      },
    })) as any;

    if (!match) {
      throw new HttpException('Match not found', HttpStatus.NOT_FOUND);
    }

    // Transform to DTO (same logic as getMatchDetails)
    const imageUrls =
      match.targetHome.images && match.targetHome.images.length > 0
        ? await Promise.all(
            match.targetHome.images.map((img: { url: string }) =>
              this.s3Service.getPublicUrl(img.url),
            ),
          )
        : [];

    let matchType: MatchTypeDto = match.type as MatchTypeDto;
    if (!matchType) {
      this.logger.warn(
        `Match ${match.id} has null type in DB! Falling back to snapshot.matchType`,
      );
      matchType = (match.snapshot?.matchType || 'STANDARD') as MatchTypeDto;
    }

    const triangleMeta: TriangleMetaDto | undefined =
      matchType === MatchTypeDto.TRIANGLE && match.snapshot?.participants
        ? {
            groupId: match.groupId || match.snapshot?.groupId,
            participants: match.snapshot.participants,
            chain: match.snapshot.chain || [],
          }
        : undefined;

    return {
      id: match.id,
      uid: match.uid,
      status: match.status as unknown as MatchStatusDto,
      type: matchType,
      groupId: match.groupId || undefined,
      createdAt: match.createdAt.toISOString(),
      updatedAt: match.updatedAt.toISOString(),
      snapshot: match.snapshot,
      snapshotVersion: match.snapshotVersion,
      targetHome: {
        id: match.targetHome.id,
        rent: match.targetHome.rent,
        surface: match.targetHome.surface,
        nbRooms: match.targetHome.nbRooms,
        homeType: match.targetHome.homeType,
        addressFormatted: match.targetHome.addressFormatted,
        description: match.targetHome.description || undefined,
        imageUrls,
        imageUrl: imageUrls[0],
      },
      targetUserFirstName: match.targetIntent.user.firstName,
      triangleMeta,
      seekerIntentId: match.seekerIntentId,
      targetIntentId: match.targetIntentId,
    };
  }

  /**
   * PATCH /matching/matches/uid/:uid/status
   *
   * Update match status by UID (public identifier).
   * This is the PREFERRED endpoint for frontend (anti-enumeration).
   *
   * Allowed transitions:
   * - NEW -> IN_PROGRESS
   * - NEW -> NOT_INTERESTED
   * - IN_PROGRESS -> NOT_INTERESTED
   * - IN_PROGRESS -> NEW (reset)
   * - NOT_INTERESTED -> NEW (undo)
   *
   * Forbidden (returns 409 Conflict):
   * - Any status -> same status (no-op)
   */
  @Patch('matches/uid/:uid/status')
  async updateMatchStatusByUid(
    @Req() req: AuthenticatedRequest,
    @Param('uid') uid: string,
    @Body() body: UpdateMatchStatusDto,
  ): Promise<UpdateMatchStatusResponseDto> {
    const userId = req.user.userId;

    // Find match by UID with ownership check
    const match = await this.prisma.match.findFirst({
      where: {
        uid,
        seekerIntent: {
          userId: userId,
        },
      },
      select: { id: true, status: true, uid: true },
    });

    if (!match) {
      throw new HttpException('Match not found', HttpStatus.NOT_FOUND);
    }

    // Validate status transition
    const currentStatus = match.status;
    const newStatus = body.status as unknown as MatchStatus;

    const transitionResult = this.isValidTransition(currentStatus, newStatus);

    if (transitionResult === 'CONFLICT') {
      this.logger.warn(
        `Match uid=${uid}: attempted no-op transition ${currentStatus} -> ${newStatus}`,
      );
      throw new HttpException(
        `Le match est déjà dans le statut ${currentStatus}`,
        HttpStatus.CONFLICT,
      );
    }

    if (!transitionResult) {
      throw new HttpException(
        `Invalid status transition from ${currentStatus} to ${newStatus}`,
        HttpStatus.BAD_REQUEST,
      );
    }

    // Update the match
    const updated = await this.prisma.match.update({
      where: { id: match.id },
      data: { status: newStatus },
    });

    this.logger.log(
      `Match uid=${uid} status updated: ${currentStatus} -> ${newStatus}`,
    );

    return {
      id: updated.id,
      status: updated.status as unknown as MatchStatusDto,
      updatedAt: updated.updatedAt.toISOString(),
    };
  }
}
