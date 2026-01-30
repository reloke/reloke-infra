import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Match status enum - mirrors Prisma MatchStatus
 */
export enum MatchStatusDto {
  NEW = 'NEW',
  IN_PROGRESS = 'IN_PROGRESS',
  NOT_INTERESTED = 'NOT_INTERESTED',
  ARCHIVED = 'ARCHIVED',
}

/**
 * Match type enum - mirrors Prisma MatchType
 * STANDARD: Direct A<->B exchange
 * TRIANGLE: A->B->C->A cycle
 */
export enum MatchTypeDto {
  STANDARD = 'STANDARD',
  TRIANGLE = 'TRIANGLE',
}

/**
 * Filter options for match list query
 */
export enum MatchFilterStatus {
  ALL = 'ALL',
  NEW = 'NEW',
  IN_PROGRESS = 'IN_PROGRESS',
  NOT_INTERESTED = 'NOT_INTERESTED',
  ARCHIVED = 'ARCHIVED',
}

/**
 * Sort order for match list
 */
export enum MatchSortOrder {
  NEWEST = 'NEWEST',
  OLDEST = 'OLDEST',
}

/**
 * Query parameters for GET /matching/matches
 */
export class GetMatchesQueryDto {
  @IsOptional()
  @IsEnum(MatchFilterStatus)
  status?: MatchFilterStatus = MatchFilterStatus.ALL;

  @IsOptional()
  @IsEnum(MatchSortOrder)
  sort?: MatchSortOrder = MatchSortOrder.NEWEST;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number = 10;

  // Cursor-based pagination for infinite scroll (optional)
  @IsOptional()
  @IsString()
  cursor?: string;

  // ISO date string for incremental fetch (optional)
  @IsOptional()
  @IsString()
  since?: string;
}

/**
 * DTO for updating match status
 */
export class UpdateMatchStatusDto {
  @IsEnum(MatchStatusDto)
  status: MatchStatusDto;
}

/**
 * Home summary for match response
 */
export interface HomeInfoDto {
  id: number;
  rent: number;
  surface: number;
  nbRooms: number;
  homeType: string;
  addressFormatted: string;
  description?: string;
  /**
   * Ordered list of image URLs (already resolved via S3Service public URLs)
   */
  imageUrls: string[];
  /**
   * Convenience cover image (first image in array) for quick display/backward compatibility
   */
  imageUrl?: string;
}

/**
 * Triangle participant info (for UI display)
 */
export interface TriangleParticipantDto {
  userId: number;
  firstName: string;
  lastName: string;
  homeId: number;
  homeAddress?: string;
}

/**
 * Triangle chain step (for UI explanation)
 */
export interface TriangleChainStepDto {
  from: { userId: number; name: string };
  gets: { homeId: number; address?: string };
  sendsTo: { userId: number; name: string };
}

/**
 * Triangle metadata for UI (included in TRIANGLE matches)
 */
export interface TriangleMetaDto {
  groupId: string;
  participants: {
    A: TriangleParticipantDto;
    B: TriangleParticipantDto;
    C: TriangleParticipantDto;
  };
  chain: TriangleChainStepDto[];
}

/**
 * Single match item response
 */
export interface MatchItemDto {
  id: number;
  // Public UID for URLs (prevents enumeration attacks)
  uid: string;
  status: MatchStatusDto;
  // Match type: STANDARD (direct exchange) or TRIANGLE (3-way cycle)
  type: MatchTypeDto;
  // groupId for TRIANGLE matches (shared by all 3 Match rows)
  groupId?: string;
  createdAt: string;
  updatedAt: string;
  targetHome: HomeInfoDto;
  // Optionally include target user basic info (first name only for privacy)
  targetUserFirstName?: string;
  // Triangle metadata (only present for TRIANGLE matches)
  triangleMeta?: TriangleMetaDto;
  // Intent IDs for edge evaluation lookup (needed for TRIANGLE criteria display)
  seekerIntentId?: number;
  targetIntentId?: number;
}

/**
 * Paginated match list response
 */
export interface MatchListResponseDto {
  items: MatchItemDto[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
    hasMore: boolean;
  };
  // For cursor-based pagination
  nextCursor?: string;
  // Max createdAt for returned items (server computed)
  maxCreatedAt?: string | null;
}

/**
 * Match status summary response (for status card)
 */
export interface MatchStatusSummaryDto {
  isInFlow: boolean;
  totalMatchesPurchased: number;
  totalMatchesUsed: number;
  totalMatchesRemaining: number;
  totalMatches: number;
  newMatches: number;
  inProgressMatches: number;
  lastMatchesSeenAt: string | null;
  serverNow: string;
}

export interface MatchMarkSeenResponseDto {
  success: boolean;
  lastMatchesSeenAt: string | null;
}

/**
 * Response after updating match status
 */
export interface UpdateMatchStatusResponseDto {
  id: number;
  status: MatchStatusDto;
  updatedAt: string;
}

/**
 * Detailed match item response (for details page)
 * Inherits type, groupId, triangleMeta from MatchItemDto
 */
export interface MatchItemDetailsDto extends MatchItemDto {
  snapshot: any; // JSON content
  snapshotVersion: number;
}
