import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface KycSessionResponse {
    success: boolean;
    sessionId: string;
    verificationUrl: string;
}

export interface KycStatusResponse {
    kycStatus: 'UNVERIFIED' | 'PENDING' | 'PROCESSING' | 'VERIFIED' | 'REQUIRES_INPUT' | 'CANCELED' | 'REJECTED' | 'DECLINED';
    kycReason?: string | null;
    isVerified: boolean;
    isKycVerified: boolean;
    verifiedAt?: string;
}

@Injectable({
    providedIn: 'root'
})
export class IdentityService {
    private apiUrl = `${environment.apiUrl}/kyc`;

    constructor(private http: HttpClient) { }

    /**
     * Start a Didit Identity Verification Session
     * Returns the verification URL to redirect the user to
     */
    startVerification(): Observable<KycSessionResponse> {
        return this.http.post<KycSessionResponse>(`${this.apiUrl}/create-session`, {});
    }

    /**
     * Get current KYC status for the authenticated user
     */
    getStatus(): Observable<KycStatusResponse> {
        return this.http.get<KycStatusResponse>(`${this.apiUrl}/status`);
    }
}
