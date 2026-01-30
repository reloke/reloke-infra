import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from 'src/environments/environment';
import { Observable } from 'rxjs';

/**
 * Service to handle DossierFacile V1 (simplified external link)
 */
@Injectable({
    providedIn: 'root'
})
export class DossierFacileService {
    private apiUrl = `${environment.apiUrl}/dossier-facile`;

    constructor(private http: HttpClient) { }

    /**
     * Saves the DossierFacile URL for the current user
     */
    updateUrl(url: string): Observable<any> {
        return this.http.post(`${this.apiUrl}/update-url`, { url });
    }

    /**
     * Request backend to validate the format and availability of a DossierFacile URL
     */
    validateUrl(url: string): Observable<{ isValid: boolean; error?: string }> {
        return this.http.post<{ isValid: boolean; error?: string }>(`${this.apiUrl}/validate-url`, { url });
    }
}
