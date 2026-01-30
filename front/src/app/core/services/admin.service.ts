import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

// Financial Statistics Interfaces
export interface FinancialStats {
  totalRevenue: string;
  earnedRevenue: string;
  refundedRevenue: string;
  pendingRevenue: string;
  totalMatchesSold: number;
  totalMatchesUsed: number;
  totalMatchesRefunded: number;
  totalMatchesPending: number;
  totalPayments: number;
  successfulPayments: number;
  refundedPayments: number;
  partiallyRefundedPayments: number;
}

export interface TimeSeriesDataPoint {
  date: string;
  matchesUsed: number;
  revenueUsed: string;
  matchesRefunded: number;
  revenueRefunded: string;
}

export type TimeSeriesPeriod = 'day' | 'week' | 'month' | 'year';

export interface TimeSeriesResponse {
  period: TimeSeriesPeriod;
  data: TimeSeriesDataPoint[];
  totals: {
    matchesUsed: number;
    revenueUsed: string;
    matchesRefunded: number;
    revenueRefunded: string;
  };
}

@Injectable({
  providedIn: 'root'
})
export class AdminService {
  private apiUrl = `${environment.apiUrl}/admin`;

  constructor(private http: HttpClient) { }

  getStats(): Observable<any> {
    return this.http.get(`${this.apiUrl}/stats`);
  }

  getUsers(search?: string, role?: string, status?: string, page?: number, cursor?: string, limit?: number): Observable<any> {
    const params: any = {};
    if (search) params.search = search;
    if (role) params.role = role;
    if (status) params.status = status;
    if (page) params.page = page.toString();
    if (cursor) params.cursor = cursor;
    if (limit) params.limit = limit.toString();
    return this.http.get<any>(`${this.apiUrl}/users`, { params });
  }

  getUserLogs(userId: number): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/users/${userId}/logs`);
  }

  validateUser(userId: number): Observable<any> {
    // Legacy or alias to verifyUser(true)
    return this.verifyUser(userId, true);
  }

  banUser(userId: number, details?: { reason?: string; customMessage?: string; template?: string }): Observable<any> {
    return this.http.post(`${this.apiUrl}/users/${userId}/ban`, details || {});
  }

  unbanUser(userId: number): Observable<any> {
    return this.http.post(`${this.apiUrl}/users/${userId}/unban`, {});
  }

  verifyUser(userId: number, approved: boolean, reason?: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/users/${userId}/verify`, { approved, reason });
  }

  refundUser(userId: number): Observable<any> {
    return this.http.post(`${this.apiUrl}/users/${userId}/refund`, {});
  }

  // --- Influencers & Promos ---

  getInfluencers(): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/influencers`);
  }

  createInfluencer(data: any): Observable<any> {
    return this.http.post(`${this.apiUrl}/influencers`, data);
  }

  getInfluencerDeletionImpact(id: number): Observable<any> {
    return this.http.get(`${this.apiUrl}/influencers/${id}/impact`);
  }

  deleteInfluencer(id: number): Observable<any> {
    return this.http.post(`${this.apiUrl}/influencers/${id}/delete`, {});
  }

  sendInfluencerReport(id: number): Observable<any> {
    return this.http.post(`${this.apiUrl}/influencers/${id}/report`, {});
  }

  generateInfluencerLink(id: number): Observable<any> {
    return this.http.post(`${environment.apiUrl}/influencers/admin/${id}/generate-link`, {});
  }

  sendInfluencerLink(id: number): Observable<any> {
    return this.http.post(`${environment.apiUrl}/influencers/admin/${id}/send-link`, {});
  }

  getPromos(): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/promos`);
  }

  createPromo(data: any): Observable<any> {
    return this.http.post(`${this.apiUrl}/promos`, data);
  }

  deletePromo(id: number): Observable<any> {
    return this.http.post(`${this.apiUrl}/promos/${id}/delete`, {});
  }

  updateInfluencer(id: number, data: any): Observable<any> {
    return this.http.put(`${this.apiUrl}/influencers/${id}`, data);
  }

  updatePromo(id: number, data: any): Observable<any> {
    return this.http.put(`${this.apiUrl}/promos/${id}`, data);
  }

  togglePromo(id: number): Observable<any> {
    return this.http.post(`${this.apiUrl}/promos/${id}/toggle`, {});
  }

  // --- Reports & Moderation ---

  getReports(showArchived: boolean = false): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/reports`, {
      params: { showArchived: showArchived.toString() }
    });
  }

  archiveReport(reportId: number): Observable<any> {
    return this.http.post(`${this.apiUrl}/reports/${reportId}/archive`, {});
  }

  getChatThread(chatId: number): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/chats/${chatId}/thread`);
  }

  // --- KYC Verifications ---

  getKycVerifications(search?: string, status?: string, page: number = 1, limit: number = 10): Observable<any> {
    let params = new HttpParams()
      .set('page', page.toString())
      .set('limit', limit.toString());

    if (search) params = params.set('search', search);
    if (status) params = params.set('status', status);

    return this.http.get<any>(`${this.apiUrl}/verifications`, { params });
  }

  sendKycClarification(userId: number, reason: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/verifications/${userId}/clarify`, { reason });
  }

  resetUserKyc(userId: number): Observable<any> {
    return this.http.post(`${this.apiUrl}/users/${userId}/reset-kyc`, {});
  }

  // --- Help Requests ---

  getHelpRequests(status?: string, cursor?: string, limit?: number): Observable<any> {
    const params: any = {};
    if (status) params.status = status;
    if (cursor) params.cursor = cursor;
    if (limit) params.limit = limit.toString();
    return this.http.get(`${this.apiUrl}/help/requests`, { params });
  }

  getAuditLogs(page: number = 1, limit: number = 20): Observable<any> {
    const params = new HttpParams()
      .set('page', page.toString())
      .set('limit', limit.toString());
    return this.http.get(`${this.apiUrl}/logs`, { params });
  }

  getHelpStats(): Observable<{ open: number; inProgress: number; resolvedToday: number }> {
    return this.http.get<{ open: number; inProgress: number; resolvedToday: number }>(`${this.apiUrl}/help/stats`);
  }

  getHelpRequest(uid: string): Observable<any> {
    return this.http.get(`${this.apiUrl}/help/requests/${uid}`);
  }

  getHelpRequestContext(uid: string): Observable<any> {
    return this.http.get(`${this.apiUrl}/help/requests/${uid}/context`);
  }

  claimHelpRequest(uid: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/help/requests/${uid}/claim`, {});
  }

  releaseHelpRequest(uid: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/help/requests/${uid}/release`, {});
  }

  resolveHelpRequest(uid: string, resolutionNote?: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/help/requests/${uid}/resolve`, { resolutionNote });
  }

  // --- Financial Statistics ---

  /**
   * Get comprehensive financial statistics with precise calculations
   */
  getFinancialStats(): Observable<FinancialStats> {
    return this.http.get<FinancialStats>(`${this.apiUrl}/financial/stats`);
  }

  /**
   * Get time series data for charts (matches used/refunded)
   * @param period - 'day' | 'week' | 'month' | 'year'
   * @param startDate - Optional start date (ISO string)
   * @param endDate - Optional end date (ISO string)
   */
  getFinancialTimeSeries(
    period: TimeSeriesPeriod = 'day',
    startDate?: string,
    endDate?: string
  ): Observable<TimeSeriesResponse> {
    let params = new HttpParams().set('period', period);
    if (startDate) {
      params = params.set('startDate', startDate);
    }
    if (endDate) {
      params = params.set('endDate', endDate);
    }
    return this.http.get<TimeSeriesResponse>(`${this.apiUrl}/financial/timeseries`, { params });
  }
}
