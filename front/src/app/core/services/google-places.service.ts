import { Injectable, NgZone } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

declare const google: any;

export interface PlacePrediction {
  placeId: string;
  description: string;
  mainText: string;
  secondaryText: string;
}

export interface PlaceDetails {
  placeId: string;
  formattedAddress: string;
  name: string;
  latitude: number;
  longitude: number;
  viewport: {
    northeast: { lat: number; lng: number };
    southwest: { lat: number; lng: number };
  };
  radius: number;
}

@Injectable({
  providedIn: 'root',
})
export class GooglePlacesService {
  private apiLoaded$ = new BehaviorSubject<boolean>(false);
  private autocompleteService: any = null;
  private placesService: any = null;
  private sessionToken: any = null;
  private sessionTokenCreatedAt: number = 0;
  private readonly SESSION_TOKEN_LIFETIME_MS = 180000; // 3 minutes
  private loadingPromise: Promise<boolean> | null = null;

  constructor(private ngZone: NgZone) {}

  /**
   * Charge l'API Google Maps de façon lazy
   */
  loadGoogleMapsApi(apiKey: string): Promise<boolean> {
    console.log('[SERVICE DEBUG] loadGoogleMapsApi called with key:', apiKey ? 'Present' : 'MISSING');

    if (this.isApiLoaded()) {
      console.log('[SERVICE DEBUG] API already loaded, returning true');
      return Promise.resolve(true);
    }

    if (this.loadingPromise) {
      console.log('[SERVICE DEBUG] Loading already in progress, returning existing promise');
      return this.loadingPromise;
    }

    console.log('[SERVICE DEBUG] Starting to load Google Maps API...');

    this.loadingPromise = new Promise((resolve, reject) => {
      const existingScript = document.querySelector('script[src*="maps.googleapis.com"]');
      console.log('[SERVICE DEBUG] Existing script found:', !!existingScript);

      if (existingScript) {
        console.log('[SERVICE DEBUG] Waiting for existing script to load...');
        this.waitForGoogleApi()
          .then(() => {
            console.log('[SERVICE DEBUG] Existing script loaded, initializing services');
            this.initializeServices();
            this.apiLoaded$.next(true);
            resolve(true);
          })
          .catch((err) => {
            console.error('[SERVICE DEBUG] waitForGoogleApi failed:', err);
            reject(err);
          });
        return;
      }

      const callbackName = `googleMapsCallback_${Date.now()}`;
      console.log('[SERVICE DEBUG] Creating new script with callback:', callbackName);

      (window as any)[callbackName] = () => {
        console.log('[SERVICE DEBUG] Google Maps callback executed');
        this.ngZone.run(() => {
          this.initializeServices();
          this.apiLoaded$.next(true);
          delete (window as any)[callbackName];
          console.log('[SERVICE DEBUG] Services initialized, resolving promise');
          resolve(true);
        });
      };

      const script = document.createElement('script');
      script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places&callback=${callbackName}&loading=async`;
      script.async = true;
      script.defer = true;
      script.onerror = (err) => {
        console.error('[SERVICE DEBUG] Script loading error:', err);
        delete (window as any)[callbackName];
        this.loadingPromise = null;
        reject(new Error('Échec du chargement de Google Maps API'));
      };

      console.log('[SERVICE DEBUG] Appending script to head:', script.src);
      document.head.appendChild(script);
    });

    return this.loadingPromise;
  }

  private waitForGoogleApi(retries = 0): Promise<void> {
    return new Promise((resolve, reject) => {
      if (typeof google !== 'undefined' && google.maps?.places) {
        resolve();
        return;
      }
      if (retries >= 10) {
        reject(new Error('Google Maps API timeout'));
        return;
      }
      setTimeout(() => this.waitForGoogleApi(retries + 1).then(resolve).catch(reject), 300);
    });
  }

  private initializeServices(): void {
    if (typeof google !== 'undefined' && google.maps?.places) {
      this.autocompleteService = new google.maps.places.AutocompleteService();
      const dummyDiv = document.createElement('div');
      this.placesService = new google.maps.places.PlacesService(dummyDiv);
      this.refreshSessionToken();
    }
  }

  isApiLoaded(): boolean {
    return typeof google !== 'undefined' && google.maps?.places && this.autocompleteService !== null;
  }

  get apiLoaded(): Observable<boolean> {
    return this.apiLoaded$.asObservable();
  }

  /**
   * Rafraîchit le session token - IMPORTANT pour la facturation groupée
   */
  refreshSessionToken(): void {
    if (typeof google !== 'undefined' && google.maps?.places) {
      this.sessionToken = new google.maps.places.AutocompleteSessionToken();
      this.sessionTokenCreatedAt = Date.now();
    }
  }

  private isSessionTokenExpired(): boolean {
    return Date.now() - this.sessionTokenCreatedAt > this.SESSION_TOKEN_LIFETIME_MS;
  }

  private getValidSessionToken(): any {
    if (!this.sessionToken || this.isSessionTokenExpired()) {
      this.refreshSessionToken();
    }
    return this.sessionToken;
  }

  /**
   * Recherche des prédictions avec Session Token
   */
  getPredictions(input: string, options: { country?: string; types?: string[] } = {}): Promise<PlacePrediction[]> {
    console.log('[SERVICE DEBUG] getPredictions called with input:', input);
    console.log('[SERVICE DEBUG] isApiLoaded:', this.isApiLoaded());
    console.log('[SERVICE DEBUG] autocompleteService:', this.autocompleteService);

    return new Promise((resolve, reject) => {
      if (!this.isApiLoaded()) {
        console.error('[SERVICE DEBUG] API not loaded!');
        reject(new Error('Google Places API non chargée'));
        return;
      }

      if (!input || input.trim().length < 2) {
        console.log('[SERVICE DEBUG] Input too short, returning empty');
        resolve([]);
        return;
      }

      const request: any = {
        input: input.trim(),
        sessionToken: this.getValidSessionToken(),
      };

      if (options.country) {
        request.componentRestrictions = { country: options.country };
      }
      if (options.types?.length) {
        request.types = options.types;
      }

      console.log('[SERVICE DEBUG] Sending request to Google:', request);

      this.autocompleteService.getPlacePredictions(request, (predictions: any[], status: string) => {
        console.log('[SERVICE DEBUG] Google response - status:', status, 'predictions:', predictions);
        this.ngZone.run(() => {
          if (status === google.maps.places.PlacesServiceStatus.OK && predictions) {
            const mapped = predictions.map((p) => ({
              placeId: p.place_id,
              description: p.description,
              mainText: p.structured_formatting?.main_text || p.description,
              secondaryText: p.structured_formatting?.secondary_text || '',
            }));
            console.log('[SERVICE DEBUG] Mapped predictions:', mapped);
            resolve(mapped);
          } else if (status === google.maps.places.PlacesServiceStatus.ZERO_RESULTS) {
            console.log('[SERVICE DEBUG] Zero results from Google');
            resolve([]);
          } else {
            console.log('[SERVICE DEBUG] Other status:', status);
            resolve([]);
          }
        });
      });
    });
  }

  /**
   * Obtient les détails d'un lieu - utilise le même Session Token
   */
  getPlaceDetails(placeId: string): Promise<PlaceDetails> {
    return new Promise((resolve, reject) => {
      if (!this.isApiLoaded()) {
        reject(new Error('Google Places API non chargée'));
        return;
      }

      const request = {
        placeId,
        fields: ['place_id', 'formatted_address', 'geometry', 'name'],
        sessionToken: this.getValidSessionToken(),
      };

      this.placesService.getDetails(request, (place: any, status: string) => {
        this.ngZone.run(() => {
          if (status === google.maps.places.PlacesServiceStatus.OK && place) {
            // IMPORTANT: Rafraîchir le token après sélection
            this.refreshSessionToken();

            resolve({
              placeId: place.place_id,
              formattedAddress: place.formatted_address || place.name,
              name: place.name || place.formatted_address,
              latitude: place.geometry.location.lat(),
              longitude: place.geometry.location.lng(),
              viewport: {
                northeast: {
                  lat: place.geometry.viewport.getNorthEast().lat(),
                  lng: place.geometry.viewport.getNorthEast().lng(),
                },
                southwest: {
                  lat: place.geometry.viewport.getSouthWest().lat(),
                  lng: place.geometry.viewport.getSouthWest().lng(),
                },
              },
              radius: this.calculateRadius(
                place.geometry.location.lat(),
                place.geometry.location.lng(),
                place.geometry.viewport.getNorthEast().lat(),
                place.geometry.viewport.getNorthEast().lng()
              ),
            });
          } else {
            reject(new Error(`Places API error: ${status}`));
          }
        });
      });
    });
  }

  private calculateRadius(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 1.1);
  }

  cleanup(): void {
    this.sessionToken = null;
  }
}
