import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

// ============================================================
// Types
// ============================================================

export interface TransactionListItem {
  id: number;
  occurredAt: string;
  type: string;
  status: string;
  amountTotal: number | null;
  currency: string | null;
  stripeObjectId: string | null;
  paymentId: number | null;
}

/**
 * Payment details for transaction detail modal
 */
export interface PaymentDetails {
  id: number;
  planType: string;
  matchesInitial: number;
  matchesUsed: number;
  matchesRefunded: number;
  matchesRemaining: number;
  amountBase: number;
  amountFees: number;
  amountTotal: number;
  pricePerMatch: number;
  status: string;
  createdAt: string;
  succeededAt: string | null;
  refundedAt: string | null;
}

/**
 * Transaction with payment details (for detail modal)
 */
export interface TransactionDetails extends TransactionListItem {
  payment: PaymentDetails | null;
}

export interface TransactionTableResponse {
  items: TransactionListItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface TransactionFeedResponse {
  items: TransactionListItem[];
  nextCursor: string | null;
  hasMore: boolean;
}

// ============================================================
// Service
// ============================================================

@Injectable({
  providedIn: 'root',
})
export class TransactionsApiService {
  private readonly baseUrl = `${environment.apiUrl}/transactions`;

  constructor(private http: HttpClient) {}

  /**
   * Get transactions for desktop table (page-based pagination)
   */
  getTransactionsTable(
    page: number = 1,
    pageSize: number = 20
  ): Observable<TransactionTableResponse> {
    const params = new HttpParams()
      .set('page', page.toString())
      .set('pageSize', pageSize.toString());

    return this.http.get<TransactionTableResponse>(`${this.baseUrl}/table`, {
      params,
    });
  }

  /**
   * Get transactions for mobile feed (cursor-based infinite scroll)
   */
  getTransactionsFeed(
    limit: number = 20,
    cursor?: string
  ): Observable<TransactionFeedResponse> {
    let params = new HttpParams().set('limit', limit.toString());

    if (cursor) {
      params = params.set('cursor', cursor);
    }

    return this.http.get<TransactionFeedResponse>(`${this.baseUrl}/feed`, {
      params,
    });
  }

  /**
   * Get single transaction with payment details (for detail modal)
   */
  getTransactionDetails(id: number): Observable<TransactionDetails> {
    return this.http.get<TransactionDetails>(`${this.baseUrl}/${id}`);
  }
}
