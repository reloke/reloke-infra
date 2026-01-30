import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { Search, CreateSearchPayload } from '../models/search.model';

@Injectable({
  providedIn: 'root',
})
export class SearcherService {
  private readonly apiUrl = `${environment.apiUrl}/searches`;

  constructor(private http: HttpClient) {}

  /**
   * Get the current user's search profile
   */
  getMySearch(): Observable<Search | null> {
    return this.http
      .get<Search | null>(`${this.apiUrl}/me`)
      .pipe(catchError(this.handleError));
  }

  /**
   * Create a new search profile
   */
  createSearch(payload: CreateSearchPayload): Observable<Search> {
    return this.http
      .post<Search>(this.apiUrl, payload)
      .pipe(catchError(this.handleError));
  }

  /**
   * Update an existing search profile
   */
  updateSearch(id: number, payload: CreateSearchPayload): Observable<Search> {
    return this.http
      .put<Search>(`${this.apiUrl}/${id}`, payload)
      .pipe(catchError(this.handleError));
  }

  /**
   * Stop search - user no longer wants to receive matches/emails
   */
  stopSearch(): Observable<{ success: boolean; message: string }> {
    return this.http
      .post<{ success: boolean; message: string }>(`${this.apiUrl}/stop`, {})
      .pipe(catchError(this.handleError));
  }

  /**
   * Restart search - user wants to receive matches/emails again
   */
  restartSearch(): Observable<{ success: boolean; message: string }> {
    return this.http
      .post<{ success: boolean; message: string }>(`${this.apiUrl}/restart`, {})
      .pipe(catchError(this.handleError));
  }

  /**
   * Update only the search period dates
   */
  updatePeriod(
    searchStartDate: string,
    searchEndDate: string,
    clientTimeZone?: string,
  ): Observable<{
    success: boolean;
    searchStartDate: string;
    searchEndDate: string;
  }> {
    return this.http
      .patch<{
        success: boolean;
        searchStartDate: string;
        searchEndDate: string;
      }>(`${this.apiUrl}/period`, { searchStartDate, searchEndDate, clientTimeZone })
      .pipe(catchError(this.handleError));
  }

  /**
   * Handle HTTP errors
   */
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
