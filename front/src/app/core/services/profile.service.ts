import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface Home {
  id?: number;
  address?: string;
  homeType: string;
  nbRooms?: number;
  rent?: number;
  surface?: number;
  description?: string;
  // Add other fields as needed
}

export interface Search {
  id?: number;
  minRent?: number;
  maxRent?: number;
  minRoomSurface?: number;
  minRoomNb?: number;
  homeType?: string;
  // Add other fields as needed
}

@Injectable({
  providedIn: 'root'
})
export class ProfileService {
  private apiUrl = `${environment.apiUrl}`;

  constructor(private http: HttpClient) { }

  // Outgoing Profile (Home)
  createHome(data: Home): Observable<Home> {
    return this.http.post<Home>(`${this.apiUrl}/homes`, data);
  }

  getHome(): Observable<Home> {
    return this.http.get<Home>(`${this.apiUrl}/homes/me`);
  }

  updateHome(id: number, data: Home): Observable<Home> {
    return this.http.put<Home>(`${this.apiUrl}/homes/${id}`, data);
  }

  // Searcher Profile (Search)
  createSearch(data: Search): Observable<Search> {
    return this.http.post<Search>(`${this.apiUrl}/searches`, data);
  }

  getSearch(): Observable<Search> {
    return this.http.get<Search>(`${this.apiUrl}/searches/me`);
  }

  updateSearch(id: number, data: Search): Observable<Search> {
    return this.http.put<Search>(`${this.apiUrl}/searches/${id}`, data);
  }
}
