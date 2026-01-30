import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface UserHomeContext {
  hasHome: boolean;
  home?: {
    addressFormatted: string;
    homeType: string;
    nbRooms: number;
    surface: number;
    rent: number;
    description: string | null;
    imagesCount: number;
    imageUrls: string[];
  };
}

export interface UserSearchContext {
  hasSearch: boolean;
  search?: {
    minRent: number | null;
    maxRent: number | null;
    minRoomSurface: number | null;
    maxRoomSurface: number | null;
    minRoomNb: number | null;
    maxRoomNb: number | null;
    homeType: string[] | null;
    searchStartDate: Date | null;
    searchEndDate: Date | null;
    zones: { label: string | null }[];
  };
}

export interface UserCreditsContext {
  totalMatchesPurchased: number;
  totalMatchesUsed: number;
  totalMatchesRemaining: number;
  isInFlow: boolean;
  isActivelySearching: boolean;
  refundCooldownUntil: Date | null;
}

export interface UserMatchContext {
  matchUid: string;
  status: string;
  type: string;
  createdAt: Date;
  targetHome: {
    addressFormatted: string;
    homeType: string;
    rent: number;
    surface: number;
    nbRooms: number;
  };
}

export interface UserTransactionContext {
  id: number;
  type: string;
  status: string;
  amountTotal: number | null;
  currency: string;
  occurredAt: Date;
  paymentId: number | null;
}

export interface UserHelpRequestContext {
  uid: string;
  topic: string;
  status: string;
  createdAt: Date;
}

export interface UserFullContext {
  user: {
    id: number;
    uid: string;
    firstName: string;
    lastName: string;
    mail: string;
    createdAt: Date;
    isKycVerified: boolean;
    accountValidatedAt: Date | null;
    isBanned: boolean;
    banReason: string | null;
    kycStatus: string;
    role: string;
  };
  home: UserHomeContext;
  search: UserSearchContext;
  credits: UserCreditsContext;
  recentMatches: UserMatchContext[];
  recentTransactions: UserTransactionContext[];
  recentHelpRequests: UserHelpRequestContext[];
}

// Extended transaction with payment details for admin view
export interface TransactionWithPayment {
  id: number;
  type: string;
  status: string;
  amountBase: number | null;
  amountFees: number | null;
  amountTotal: number | null;
  currency: string;
  occurredAt: Date;
  stripeEventId: string | null;
  stripeObjectId: string | null;
  metadata: Record<string, unknown> | null;
  payment: PaymentDetail | null;
}

export interface PaymentDetail {
  id: number;
  stripeCheckoutSessionId: string;
  stripePaymentIntentId: string | null;
  stripeChargeId: string | null;
  stripeRefundId: string | null;
  planType: string;
  matchesInitial: number;
  matchesUsed: number;
  matchesRefunded: number;
  amountBase: number;
  amountFees: number;
  amountTotal: number;
  status: string;
  createdAt: Date;
  succeededAt: Date | null;
  refundedAt: Date | null;
}

export interface PaginatedTransactions {
  items: TransactionWithPayment[];
  total: number;
  page?: number;
  limit: number;
  totalPages?: number;
  hasMore: boolean;
  nextCursor?: string;
}

// Match with full details for admin view
export interface MatchWithDetails {
  uid: string;
  status: string;
  type: string;
  createdAt: Date;
  updatedAt: Date;
  groupId: string | null;
  seekerUser: {
    id: number;
    uid: string;
    firstName: string;
    lastName: string;
    mail: string;
  };
  targetUser: {
    id: number;
    uid: string;
    firstName: string;
    lastName: string;
    mail: string;
  };
  targetHome: {
    addressFormatted: string;
    homeType: string;
    rent: number;
    surface: number;
    nbRooms: number;
    description: string | null;
    imageUrls: string[];
  };
  seekerHome: {
    addressFormatted: string;
    homeType: string;
    rent: number;
    surface: number;
    nbRooms: number;
  } | null;
  triangleMeta: {
    participants?: {
      A?: { intentId: number; userId: number; firstName: string; lastName: string; homeAddress: string };
      B?: { intentId: number; userId: number; firstName: string; lastName: string; homeAddress: string };
      C?: { intentId: number; userId: number; firstName: string; lastName: string; homeAddress: string };
    };
    edgeEvaluations?: Record<string, unknown>;
  } | null;
  snapshot: Record<string, unknown> | null;
}

export interface PaginatedMatches {
  items: UserMatchContext[];
  total: number;
  page?: number;
  limit: number;
  totalPages?: number;
  hasMore: boolean;
  nextCursor?: string;
}

@Injectable({
  providedIn: 'root'
})
export class AdminUserService {
  private apiUrl = `${environment.apiUrl}/admin/users`;

  constructor(private http: HttpClient) {}

  /**
   * Get full user context for admin view using secure UID
   */
  getUserContextByUid(uid: string): Observable<UserFullContext> {
    return this.http.get<UserFullContext>(`${this.apiUrl}/by-uid/${uid}/context`);
  }

  /**
   * Get paginated transactions for a user (page-based for desktop)
   */
  getUserTransactions(
    uid: string,
    page: number = 1,
    limit: number = 10
  ): Observable<PaginatedTransactions> {
    const params = new HttpParams()
      .set('page', page.toString())
      .set('limit', limit.toString());

    return this.http.get<PaginatedTransactions>(
      `${this.apiUrl}/by-uid/${uid}/transactions`,
      { params }
    );
  }

  /**
   * Get paginated transactions for a user (cursor-based for mobile/infinite scroll)
   */
  getUserTransactionsCursor(
    uid: string,
    cursor?: string,
    limit: number = 10
  ): Observable<PaginatedTransactions> {
    let params = new HttpParams().set('limit', limit.toString());
    if (cursor) {
      params = params.set('cursor', cursor);
    }

    return this.http.get<PaginatedTransactions>(
      `${this.apiUrl}/by-uid/${uid}/transactions`,
      { params }
    );
  }

  /**
   * Get detailed transaction info including payment and Stripe metadata
   */
  getTransactionDetail(transactionId: number): Observable<TransactionWithPayment> {
    return this.http.get<TransactionWithPayment>(
      `${this.apiUrl}/transactions/${transactionId}`
    );
  }

  /**
   * Get paginated matches for a user (page-based for desktop)
   */
  getUserMatches(
    uid: string,
    page: number = 1,
    limit: number = 10
  ): Observable<PaginatedMatches> {
    const params = new HttpParams()
      .set('page', page.toString())
      .set('limit', limit.toString());

    return this.http.get<PaginatedMatches>(
      `${this.apiUrl}/by-uid/${uid}/matches`,
      { params }
    );
  }

  /**
   * Get paginated matches for a user (cursor-based for mobile/infinite scroll)
   */
  getUserMatchesCursor(
    uid: string,
    cursor?: string,
    limit: number = 10
  ): Observable<PaginatedMatches> {
    let params = new HttpParams().set('limit', limit.toString());
    if (cursor) {
      params = params.set('cursor', cursor);
    }

    return this.http.get<PaginatedMatches>(
      `${this.apiUrl}/by-uid/${uid}/matches`,
      { params }
    );
  }

  /**
   * Get detailed match info including users, homes, and snapshot data
   */
  getMatchDetail(matchUid: string): Observable<MatchWithDetails> {
    return this.http.get<MatchWithDetails>(
      `${this.apiUrl}/matches/${matchUid}`
    );
  }

  // ============================================
  // DEPRECATED METHODS - Use UID-based methods instead
  // ============================================

  /**
   * @deprecated Use getUserContextByUid instead
   * Get full user context for admin view using numeric ID
   */
  getUserContext(userId: number): Observable<UserFullContext> {
    return this.http.get<UserFullContext>(`${this.apiUrl}/${userId}/context`);
  }
}
