import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

@Injectable({
    providedIn: 'root'
})
export class UserService {
    private apiUrl = `${environment.apiUrl}/user`;

    constructor(private http: HttpClient) { }

    updateProfile(data: { firstName?: string; lastName?: string }): Observable<any> {
        return this.http.patch(`${this.apiUrl}/profile`, data);
    }

    requestDeletion(): Observable<any> {
        return this.http.post(`${this.apiUrl}/delete-request`, {});
    }

    cancelDeletion(): Observable<any> {
        return this.http.post(`${this.apiUrl}/cancel-delete-request`, {});
    }

    getDeletionPrecheck(): Observable<{ isInFlow: boolean; hasCredits: boolean; remainingCredits: number }> {
        return this.http.get<{ isInFlow: boolean; hasCredits: boolean; remainingCredits: number }>(`${this.apiUrl}/deletion-precheck`);
    }

    updateOnboarding(completed: boolean): Observable<any> {
        return this.http.patch(`${this.apiUrl}/onboarding/complete`, {});
    }

    updatePushSettings(pushEnabled: boolean): Observable<any> {
        return this.http.patch(`${this.apiUrl}/push-settings`, { pushEnabled });
    }

    downloadUserExport(format: string = 'xlsx'): Observable<Blob> {
        return this.http.get(`${environment.apiUrl}/profile/export`, {
            params: { format },
            responseType: 'blob'
        });
    }
}
