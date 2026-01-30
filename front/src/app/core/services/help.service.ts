import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface HelpRequestAttachment {
  id: number;
  url: string;
  order: number;
}

export interface HelpRequest {
  uid: string;
  topic: string;
  description: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  attachments: HelpRequestAttachment[];
  resolvedAt?: Date | null;
  resolutionNote?: string | null;
}

export interface HelpRequestListItem {
  uid: string;
  topic: string;
  status: string;
  createdAt: Date;
  hasAttachments: boolean;
}

export interface PaginatedHelpRequests {
  items: HelpRequestListItem[];
  total: number;
  hasMore: boolean;
  nextCursor?: string;
}

export interface UploadResponse {
  key: string;
}

export type HelpTopic = 'HOME' | 'SEARCH' | 'SEARCH_CRITERIA' | 'MATCHES' | 'PAYMENTS' | 'OTHER';

@Injectable({
  providedIn: 'root'
})
export class HelpService {
  private apiUrl = `${environment.apiUrl}/help`;

  constructor(private http: HttpClient) {}

  /**
   * Upload a single attachment file via backend
   */
  uploadAttachment(file: File): Observable<UploadResponse> {
    const formData = new FormData();
    formData.append('file', file);
    return this.http.post<UploadResponse>(`${this.apiUrl}/upload`, formData);
  }

  /**
   * Create a new help request
   */
  createHelpRequest(topic: HelpTopic, description: string, attachmentKeys?: string[]): Observable<HelpRequest> {
    return this.http.post<HelpRequest>(`${this.apiUrl}/requests`, {
      topic,
      description,
      attachmentKeys
    });
  }

  /**
   * Get user's help requests list
   */
  getMyHelpRequests(): Observable<HelpRequestListItem[]> {
    return this.http.get<HelpRequestListItem[]>(`${this.apiUrl}/requests`);
  }

  /**
   * Get user's help requests list (paginated)
   */
  getMyHelpRequestsPaginated(cursor?: string, take = 10): Observable<PaginatedHelpRequests> {
    const params: any = { take: take.toString() };
    if (cursor) params.cursor = cursor;
    return this.http.get<PaginatedHelpRequests>(`${this.apiUrl}/requests/paginated`, { params });
  }

  /**
   * Get a specific help request details
   */
  getHelpRequest(uid: string): Observable<HelpRequest> {
    return this.http.get<HelpRequest>(`${this.apiUrl}/requests/${uid}`);
  }
}
