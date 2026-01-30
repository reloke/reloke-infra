import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { Home, HomeImage, CreateHomePayload } from '../models/home.model';

@Injectable({
  providedIn: 'root',
})
export class HomeService {
  private readonly apiUrl = `${environment.apiUrl}/homes`;

  constructor(private http: HttpClient) {}

  /**
   * Récupère le Home de l'utilisateur connecté
   */
  getMyHome(): Observable<Home | null> {
    return this.http
      .get<Home | null>(`${this.apiUrl}/me`)
      .pipe(catchError(this.handleError));
  }

  /**
   * Crée ou met à jour le Home
   */
  saveHome(payload: CreateHomePayload): Observable<Home> {
    return this.http
      .post<Home>(this.apiUrl, payload)
      .pipe(catchError(this.handleError));
  }

  /**
   * Met à jour uniquement la description
   */
  updateDescription(description: string | null): Observable<Home> {
    return this.http
      .put<Home>(`${this.apiUrl}/description`, { description })
      .pipe(catchError(this.handleError));
  }

  /**
   * Récupère les images d'un Home
   */
  getHomeImages(homeId: number): Observable<HomeImage[]> {
    return this.http
      .get<HomeImage[]>(`${this.apiUrl}/${homeId}/images`)
      .pipe(catchError(this.handleError));
  }

  /**
   * Upload des images
   */
  uploadImages(homeId: number, files: File[]): Observable<HomeImage[]> {
    const formData = new FormData();
    files.forEach((file) => {
      formData.append('files', file, file.name);
    });

    return this.http
      .post<HomeImage[]>(`${this.apiUrl}/${homeId}/images`, formData)
      .pipe(catchError(this.handleError));
  }

  /**
   * Supprime une image
   */
  deleteImage(homeId: number, imageId: number): Observable<void> {
    return this.http
      .delete<void>(`${this.apiUrl}/${homeId}/images/${imageId}`)
      .pipe(catchError(this.handleError));
  }

  /**
   * Synchronise en une seule requÃªte les ajouts et suppressions d'images
   */
  syncHomeImages(
    homeId: number,
    newFiles: File[],
    deleteIds: number[],
  ): Observable<HomeImage[]> {
    const formData = new FormData();

    newFiles.forEach((file) => {
      formData.append('newImages', file, file.name);
    });

    formData.append('deleteImageIds', JSON.stringify(deleteIds || []));

    return this.http
      .put<HomeImage[]>(`${this.apiUrl}/${homeId}/images`, formData)
      .pipe(catchError(this.handleError));
  }

  /**
   * Réordonne les images
   */
  reorderImages(homeId: number, imageIds: number[]): Observable<HomeImage[]> {
    return this.http
      .put<HomeImage[]>(`${this.apiUrl}/${homeId}/images/reorder`, { imageIds })
      .pipe(catchError(this.handleError));
  }

  /**
   * Valide le nombre d'images
   */
  validateImageCount(
    homeId: number
  ): Observable<{ valid: boolean; count: number; message?: string }> {
    return this.http
      .get<{ valid: boolean; count: number; message?: string }>(
        `${this.apiUrl}/${homeId}/images/validate`
      )
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
