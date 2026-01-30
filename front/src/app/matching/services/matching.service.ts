import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '../../../environments/environment';

// Interface matching backend PackInfoDto
interface BackendPackInfo {
  planType: string;
  label: string;
  labelFr: string;
  matches: number;
  baseAmount: number;
  fees: number;
  totalAmount: number;
  pricePerMatch: number;
  description: string;
  isRecommended: boolean;
}

export interface MatchIntent {
  id: number;
  intentPrice: number;
  home: {
    id: number;
    homeType: string;
    rent: number;
    surface: number;
    nbRooms: number;
    description: string;
    address?: string;
    images: { url: string }[];
  };
  user: {
    firstName: string;
    lastName?: string;
  };
}

// Interface for frontend display
export interface PackInfo {
  planType: string;
  name: string;
  matchesIncluded: number;
  amountBase: number;
  amountFees: number;
  amountTotal: number;
  pricePerMatch: number;
  isPopular: boolean;
}

export interface CheckoutSessionResponse {
  url: string;
}

export interface PaymentInfo {
  id: number;
  planType: string;
  matchesInitial: number;
  matchesUsed: number;
  matchesRefunded?: number;
  matchesRemaining: number;
  amountBase: number;
  amountTotal: number;
  pricePerMatch: number;
  status: string;
  createdAt: string;
}

// Backend response format (updated with cooldown/blocking fields)
interface BackendMatchingSummary {
  totalMatchesPurchased: number;
  totalMatchesUsed: number;
  totalMatchesRemaining: number;
  isInFlow: boolean;
  payments: PaymentInfo[];
  canRequestRefund: boolean;
  potentialRefundAmount: number;

  // NEW: Refund cooldown fields
  refundCooldownUntil: string | null;
  refundCooldownRemainingMs: number | null;
  canBuyNewPack: boolean;

  // NEW: Matching processing fields
  matchingProcessingUntil: string | null;
  isRefundBlockedByMatching: boolean;

  // NEW: Blocking reason
  blockingReason: string | null;
}

// Frontend format (updated with cooldown/blocking fields)
export interface MatchingSummary {
  totalMatchesPurchased: number;
  totalMatchesUsed: number;
  totalMatchesRemaining: number;
  payments: PaymentInfo[];
  refundEligible: boolean;
  refundAmount: number;

  // NEW: Refund cooldown
  // If set, user cannot buy a new pack until this date (ISO string)
  refundCooldownUntil: string | null;
  // Remaining time in ms (for countdown display)
  refundCooldownRemainingMs: number | null;
  // Whether user can currently buy a new pack
  canBuyNewPack: boolean;

  // NEW: Matching processing
  // If set, matching is in progress (blocks refund)
  matchingProcessingUntil: string | null;
  // Whether refund is blocked due to matching
  isRefundBlockedByMatching: boolean;

  // NEW: Blocking reason ('REFUND_COOLDOWN_ACTIVE', 'MATCHING_IN_PROGRESS', or null)
  blockingReason: string | null;
}

export interface RefundResponse {
  success: boolean;
  message: string;
  refundedAmount: number;
}

// ============ MATCH LIST TYPES ============

export enum MatchStatus {
  NEW = 'NEW',
  IN_PROGRESS = 'IN_PROGRESS',
  NOT_INTERESTED = 'NOT_INTERESTED',
  ARCHIVED = 'ARCHIVED',
}

export enum MatchFilterStatus {
  ALL = 'ALL',
  NEW = 'NEW',
  IN_PROGRESS = 'IN_PROGRESS',
  NOT_INTERESTED = 'NOT_INTERESTED',
  ARCHIVED = 'ARCHIVED',
}

export enum MatchSortOrder {
  NEWEST = 'NEWEST',
  OLDEST = 'OLDEST',
}

/**
 * Match type: STANDARD (direct A<->B exchange) or TRIANGLE (A->B->C->A cycle)
 */
export enum MatchType {
  STANDARD = 'STANDARD',
  TRIANGLE = 'TRIANGLE',
}

/**
 * Triangle participant info
 */
export interface TriangleParticipant {
  userId: number;
  firstName: string;
  lastName: string;
  homeId: number;
  homeAddress?: string;
}

/**
 * Triangle chain step for UI explanation
 */
export interface TriangleChainStep {
  from: { userId: number; name: string };
  gets: { homeId: number; address?: string };
  sendsTo: { userId: number; name: string };
}

/**
 * Triangle metadata for TRIANGLE matches
 */
export interface TriangleMeta {
  groupId: string;
  participants: {
    A: TriangleParticipant;
    B: TriangleParticipant;
    C: TriangleParticipant;
  };
  chain: TriangleChainStep[];
}

// ============ TRIANGLE SNAPSHOT TYPES ============

/**
 * Zone snapshot for search criteria
 */
export interface TriangleZoneSnapshot {
  label: string;
  lat: number;
  lng: number;
  radius: number;
}

/**
 * Search criteria snapshot for a participant
 */
export interface TriangleSearchSnapshot {
  minRent: number | null;
  maxRent: number | null;
  minSurface: number | null;
  maxSurface: number | null;
  minRooms: number | null;
  maxRooms: number | null;
  homeTypes: string[] | null;
  searchStartDate: string | null;
  searchEndDate: string | null;
  zones: TriangleZoneSnapshot[];
}

/**
 * Home snapshot for a participant
 */
export interface TriangleHomeSnapshot {
  id: number;
  lat: number;
  lng: number;
  rent: number;
  surface: number;
  nbRooms: number;
  homeType: string;
  addressFormatted: string;
}

/**
 * Edge evaluation criteria result
 */
export interface EdgeCriteriaResult {
  homeValue: number | string;
  searchMin?: number | null;
  searchMax?: number | null;
  searchTypes?: string[];
  passed: boolean;
}

/**
 * Zone evaluation result
 */
export interface EdgeZoneResult {
  homeLocation: { lat: number; lng: number };
  searchZones: TriangleZoneSnapshot[];
  passed: boolean;
}

/**
 * Full edge evaluation between two participants
 */
export interface TriangleEdgeEvaluation {
  seekerIntentId: number;
  targetIntentId: number;
  targetHomeId: number;
  rent: EdgeCriteriaResult;
  surface: EdgeCriteriaResult;
  rooms: EdgeCriteriaResult;
  homeType: { homeValue: string; searchTypes: string[]; passed: boolean };
  zones: EdgeZoneResult;
}

/**
 * Complete triangle snapshot structure
 */
export interface TriangleSnapshot {
  algorithmVersion: string;
  snapshotVersion: number;
  matchType: 'TRIANGLE';
  groupId: string;
  createdAt: string;
  participants: {
    A: TriangleParticipant & { intentId: number };
    B: TriangleParticipant & { intentId: number };
    C: TriangleParticipant & { intentId: number };
  };
  chain: TriangleChainStep[];
  homes: { [homeId: number]: TriangleHomeSnapshot };
  searches: { [intentId: number]: TriangleSearchSnapshot };
  edgeEvaluations: {
    A_to_B: TriangleEdgeEvaluation;
    B_to_C: TriangleEdgeEvaluation;
    C_to_A: TriangleEdgeEvaluation;
  };
}

export interface HomeInfo {
  id: number;
  rent: number;
  surface: number;
  nbRooms: number;
  homeType: string;
  addressFormatted: string;
  description?: string;
  imageUrls?: string[];
  // cover image from backend (first entry in imageUrls) kept for backward compatibility
  imageUrl?: string;
}

export interface MatchItem {
  id: number;
  /** Public UID for URLs (prevents enumeration attacks) */
  uid: string;
  status: MatchStatus;
  /** Match type: STANDARD (direct exchange) or TRIANGLE (3-way cycle) */
  type: MatchType;
  /** groupId for TRIANGLE matches (shared by all 3 Match rows) */
  groupId?: string;
  createdAt: string;
  updatedAt: string;
  targetHome: HomeInfo;
  targetUserFirstName?: string;
  /** Triangle metadata (only present for TRIANGLE matches) */
  triangleMeta?: TriangleMeta;
}

export interface MatchItemDetails extends MatchItem {
  snapshot: any;
  snapshotVersion: number;
  /** Intent ID of the seeker (connected user's intent) - used for edge evaluation lookup */
  seekerIntentId?: number;
  /** Intent ID of the target participant - used for edge evaluation lookup */
  targetIntentId?: number;
}

export interface MatchListPagination {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  hasMore: boolean;
}

export interface MatchListResponse {
  items: MatchItem[];
  pagination: MatchListPagination;
  nextCursor?: string;
  maxCreatedAt?: string | null;
}

export interface MatchStatusSummary {
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

export interface UpdateMatchStatusResponse {
  id: number;
  status: MatchStatus;
  updatedAt: string;
}

export interface MatchMarkSeenResponse {
  success: boolean;
  lastMatchesSeenAt: string | null;
}

export interface GetMatchesParams {
  status?: MatchFilterStatus;
  sort?: MatchSortOrder;
  page?: number;
  pageSize?: number;
  cursor?: string;
  since?: string;
}

@Injectable({
  providedIn: 'root',
})
export class MatchingService {
  private readonly apiUrl = `${environment.apiUrl}/matching`;

  constructor(private http: HttpClient) { }

  /**
   * Get available packs
   */
  getAvailablePacks(): Observable<PackInfo[]> {
    return this.http
      .get<BackendPackInfo[]>(`${this.apiUrl}/packs`)
      .pipe(
        map((packs) => packs.map((pack) => this.mapBackendPackToFrontend(pack))),
        catchError(this.handleError)
      );
  }

  /**
   * Map backend pack format to frontend format
   */
  private mapBackendPackToFrontend(pack: BackendPackInfo): PackInfo {
    return {
      planType: pack.planType,
      name: pack.labelFr,
      matchesIncluded: pack.matches,
      amountBase: pack.baseAmount,
      amountFees: pack.fees,
      amountTotal: pack.totalAmount,
      pricePerMatch: pack.pricePerMatch,
      isPopular: pack.isRecommended,
    };
  }

  /**
   * Create a Stripe checkout session
   */
  createCheckoutSession(planType: string): Observable<CheckoutSessionResponse> {
    return this.http
      .post<CheckoutSessionResponse>(`${this.apiUrl}/payments/checkout-session`, { planType })
      .pipe(catchError(this.handleError));
  }

  /**
   * Create (or fetch) chat for a match group
   */
  createChatForGroup(matchGroupId: string): Observable<any> {
    return this.http
      .post<any>(`${environment.apiUrl}/chat/match-group/${matchGroupId}/create`, {})
      .pipe(catchError(this.handleError));
  }

  /**
   * Get matching summary for current user
   */
  getMatchingSummary(): Observable<MatchingSummary> {
    return this.http
      .get<BackendMatchingSummary>(`${this.apiUrl}/summary`)
      .pipe(
        map((summary) => this.mapBackendSummaryToFrontend(summary)),
        catchError(this.handleError)
      );
  }

  /**
   * Map backend summary format to frontend format
   */
  private mapBackendSummaryToFrontend(summary: BackendMatchingSummary): MatchingSummary {
    return {
      totalMatchesPurchased: summary.totalMatchesPurchased,
      totalMatchesUsed: summary.totalMatchesUsed,
      totalMatchesRemaining: summary.totalMatchesRemaining,
      payments: summary.payments,
      refundEligible: summary.canRequestRefund,
      refundAmount: summary.potentialRefundAmount,

      // Cooldown fields
      refundCooldownUntil: summary.refundCooldownUntil,
      refundCooldownRemainingMs: summary.refundCooldownRemainingMs,
      canBuyNewPack: summary.canBuyNewPack,

      // Matching processing fields
      matchingProcessingUntil: summary.matchingProcessingUntil,
      isRefundBlockedByMatching: summary.isRefundBlockedByMatching,

      // Blocking reason
      blockingReason: summary.blockingReason,
    };
  }

  /**
   * Request refund for unused matches
   */
  requestRefund(): Observable<RefundResponse> {
    return this.http
      .post<RefundResponse>(`${this.apiUrl}/refund`, {})
      .pipe(catchError(this.handleError));
  }

  // ============ MATCH LIST METHODS ============

  /**
   * Get matches list for current user
   */
  getMatches(params: GetMatchesParams = {}): Observable<MatchListResponse> {
    const queryParams: any = {};

    if (params.status) queryParams.status = params.status;
    if (params.sort) queryParams.sort = params.sort;
    if (params.page) queryParams.page = params.page.toString();
    if (params.pageSize) queryParams.pageSize = params.pageSize.toString();
    if (params.cursor) queryParams.cursor = params.cursor;
    if (params.since) queryParams.since = params.since;

    return this.http
      .get<MatchListResponse>(`${this.apiUrl}/matches`, { params: queryParams })
      .pipe(catchError(this.handleError));
  }

  /**
   * Get match details by ID (legacy - use getMatchByUid for new code)
   */
  getMatchById(id: number): Observable<MatchItemDetails> {
    return this.http
      .get<MatchItemDetails>(`${this.apiUrl}/matches/${id}`)
      .pipe(catchError(this.handleError));
  }

  /**
   * Get match details by UID (preferred - uses public identifier)
   */
  getMatchByUid(uid: string): Observable<MatchItemDetails> {
    return this.http
      .get<MatchItemDetails>(`${this.apiUrl}/matches/uid/${uid}`)
      .pipe(catchError(this.handleError));
  }

  /**
   * Update match status by UID (preferred - uses public identifier)
   */
  updateMatchStatusByUid(uid: string, status: MatchStatus): Observable<UpdateMatchStatusResponse> {
    return this.http
      .patch<UpdateMatchStatusResponse>(`${this.apiUrl}/matches/uid/${uid}/status`, { status })
      .pipe(catchError(this.handleError));
  }

  /**
   * Get match status summary for current user
   */
  getMatchStatus(): Observable<MatchStatusSummary> {
    return this.http
      .get<MatchStatusSummary>(`${this.apiUrl}/match-status`)
      .pipe(catchError(this.handleError));
  }

  markMatchesSeen(): Observable<MatchMarkSeenResponse> {
    return this.http
      .post<MatchMarkSeenResponse>(`${this.apiUrl}/matches/mark-seen`, {})
      .pipe(catchError(this.handleError));
  }

  /**
   * Get potential matches (intent-based)
   */
  getPotentialMatches(): Observable<MatchIntent[]> {
    return this.http
      .get<MatchIntent[]>(`${environment.apiUrl}/matches/potential`)
      .pipe(catchError(this.handleError));
  }

  /**
   * Request a match from an intent
   */
  requestMatch(intentId: number): Observable<any> {
    return this.http
      .post(`${environment.apiUrl}/matches/${intentId}/request`, {})
      .pipe(catchError(this.handleError));
  }

  /**
   * Update match status
   */
  updateMatchStatus(matchId: number, status: MatchStatus): Observable<UpdateMatchStatusResponse> {
    return this.http
      .patch<UpdateMatchStatusResponse>(`${this.apiUrl}/matches/${matchId}/status`, { status })
      .pipe(catchError(this.handleError));
  }

  private handleError(error: HttpErrorResponse): Observable<never> {
    let errorMessage = 'Une erreur est survenue. Veuillez réessayer.';

    if (error.error?.message) {
      if (Array.isArray(error.error.message)) {
        errorMessage = error.error.message.join('. ');
      } else {
        errorMessage = error.error.message;
      }
    }

    return throwError(() => new Error(errorMessage));
  }
}
