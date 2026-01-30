import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface InfluencerInfo {
    id: number;
    firstName: string;
    lastName: string;
}

@Injectable({
    providedIn: 'root'
})
export class InfluencerService {
    private apiUrl = `${environment.apiUrl}/influencers`;

    constructor(private http: HttpClient) { }

    getInfluencerInfo(hash: string): Observable<InfluencerInfo> {
        return this.http.get<InfluencerInfo>(`${this.apiUrl}/info`, { params: { hash } });
    }

    generateLink(influencerId: number): Observable<any> {
        return this.http.post(`${this.apiUrl}/admin/${influencerId}/generate-link`, {});
    }

    sendLink(influencerId: number): Observable<any> {
        return this.http.post(`${this.apiUrl}/admin/${influencerId}/send-link`, {});
    }
}
