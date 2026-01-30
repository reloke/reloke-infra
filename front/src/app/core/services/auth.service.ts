import { Injectable, NgZone } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { BehaviorSubject, Observable, catchError, of, tap, map } from 'rxjs';
import { Router } from '@angular/router';
import { environment } from '../../../environments/environment';
import { Role } from '../models/role.enum';

declare var google: any;

export interface User {
  id: number;
  mail: string;
  firstName: string;
  lastName: string;
  profilePicture: string | null;
  dateLastConnection: Date;
  isLocked: boolean;
  isActif: boolean;
  isKycVerified: boolean;
  status: string;
  role: Role;
  paypaldId: string | null;
  isEmailVerified: boolean;
  isBanned: boolean;
  createdAt: Date;
  updatedAt: Date;
  kycStatus:
  | 'UNVERIFIED'
  | 'PENDING'
  | 'PROCESSING'
  | 'VERIFIED'
  | 'REQUIRES_INPUT'
  | 'CANCELED'
  | 'REJECTED'
  | 'DECLINED'
  | 'MANUAL_REVIEW';
  kycReason?: string | null;
  kycAttempts?: number;
  deletedAt: Date | null;
  lastPasswordUpdate?: Date;
  accountValidatedAt?: string | Date;
  deletionScheduledAt?: string | Date | null;
  usedPromoCode?: {
    code: string;
    discountPercentage: number;
    description?: string;
  };
  hasPassword: boolean;
  provider: 'google' | 'local';
  dossierFacileUrl: string | null;
  isDossierValid: boolean;
  lastDossierCheckAt: string | Date | null;

  bannedAt?: string | Date | null;
  banReason?: string | null;
  pushEnabled: boolean;
}

export interface AuthResponse {
  user: User;
}

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private apiUrl = `${environment.apiUrl}/auth`;
  private userApiUrl = `${environment.apiUrl}/user`;
  // Initialize with null
  private currentUserSubject = new BehaviorSubject<User | null>(null);
  public currentUser$ = this.currentUserSubject.asObservable();

  constructor(
    private http: HttpClient,
    private router: Router,
    private zone: NgZone,
  ) { }

  // Initial Check (Called by APP_INITIALIZER)
  getMe(): Observable<User | null> {
    return this.http
      .get<User>(`${this.apiUrl}/me`, {
        headers: { 'X-Skip-Interceptor': 'true' },
      })
      .pipe(
        tap((user) => {
          this.currentUserSubject.next(user);
        }),
        catchError((error) => {
          if (error.status === 401) {
            return this.refreshToken(true).pipe(
              map((res) => res.user),
              tap((user) => {
                // Add tap to update currentUserSubject after successful refresh
                this.currentUserSubject.next(user);
              }),
              catchError(() => {
                this.currentUserSubject.next(null);
                return of(null);
              }),
            );
          }
          this.currentUserSubject.next(null);
          return of(null);
        }),
      );
  }

  getCurrentUser(): User | null {
    return this.currentUserSubject.value;
  }

  isAuthenticated(): boolean {
    return !!this.currentUserSubject.value;
  }

  initiateRegister(email: string, verificationToken: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/initiate-register`, {
      email,
      verificationToken,
    });
  }

  verifyCode(
    email: string,
    code: string,
  ): Observable<{ registrationToken: string }> {
    return this.http.post<{ registrationToken: string }>(
      `${this.apiUrl}/verify-code`,
      { email, code },
    );
  }

  register(data: any): Observable<any> {
    return this.http.post(`${this.apiUrl}/register`, data).pipe(
      tap((response: any) => {
        if (response.user) {
          this.currentUserSubject.next(response.user);
        }
      }),
    );
  }

  login(data: any): Observable<any> {
    const headers = new HttpHeaders().set('X-Skip-Interceptor', 'true');
    return this.http.post<any>(`${this.apiUrl}/login`, data, { headers }).pipe(
      tap(response => {
        if (response.user) {
          this.currentUserSubject.next(response.user);
        }
      })
    );
  }

  verifyLogin2FA(email: string, code: string): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${this.apiUrl}/verify-2fa`, { email, code }).pipe(
      tap(response => {
        if (response.user) {
          this.currentUserSubject.next(response.user);
        }
      })
    );
  }


  getAuthProvider(email: string): Observable<{ provider: 'GOOGLE' | 'PASSWORD', exists: boolean }> {
    return this.http.get<{ provider: 'GOOGLE' | 'PASSWORD', exists: boolean }>(`${this.apiUrl}/provider/${email}`);
  }

  googleLoginOneTap(credential: string): Observable<AuthResponse> {
    const headers = new HttpHeaders().set('X-Skip-Interceptor', 'true');
    return this.http
      .post<AuthResponse>(
        `${this.apiUrl}/google/one-tap`,
        { credential },
        { headers },
      )
      .pipe(
        tap((response) => {
          if (response.user) {
            this.currentUserSubject.next(response.user);
          }
        }),
      );
  }

  logout() {
    this.http.post(`${this.apiUrl}/logout`, {}).subscribe({
      next: () => this.finalizeLogout(),
      error: () => this.finalizeLogout(),
    });
  }

  private finalizeLogout() {
    // Google session cleanup
    if (typeof google !== 'undefined' && google.accounts.id !== 'undefined') {
      google.accounts.id.disableAutoSelect();
    }

    // Clear Google One Tap state cookie (helps during development and testing)
    document.cookie =
      'g_state=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';

    // Force navigation inside Angular zone
    this.zone.run(() => {
      // Reset local state
      this.currentUserSubject.next(null);
      this.router.navigateByUrl('/auth/login', { replaceUrl: true });
    });

  }

  forgotPassword(email: string, verificationToken: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/forgot-password`, {
      email,
      verificationToken,
    });
  }

  resetPassword(data: any): Observable<any> {
    return this.http.post(`${this.apiUrl}/reset-password`, data);
  }

  refreshToken(skipInterceptor = false): Observable<AuthResponse> {
    let headers: HttpHeaders | undefined;
    if (skipInterceptor) {
      headers = new HttpHeaders({ 'X-Skip-Interceptor': 'true' });
    }

    return this.http
      .post<AuthResponse>(`${this.apiUrl}/refresh`, {}, { headers })
      .pipe(
        tap((response) => {
          if (response.user) {
            this.currentUserSubject.next(response.user);
          }
        }),
      );
  }

  changePassword(
    oldPassword: string | undefined,
    newPassword: string,
  ): Observable<any> {
    return this.http.post(`${this.apiUrl}/change-password`, {
      oldPassword,
      newPassword,
    });
  }

  updateCurrentUser(partialUser: Partial<User>) {
    const current = this.currentUserSubject.value;
    if (current) {
      this.currentUserSubject.next({ ...current, ...partialUser });
    }
  }
  // --- Email Change Flow ---

  initiateChangeEmail(): Observable<any> {
    return this.http.post(`${this.apiUrl}/change-email/initiate`, {});
  }

  verifyOldEmail(code: string): Observable<{ changeEmailToken: string }> {
    return this.http.post<{ changeEmailToken: string }>(
      `${this.apiUrl}/change-email/verify-old`,
      { code },
    );
  }

  requestNewEmail(newEmail: string, changeEmailToken: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/change-email/request-new`, {
      newEmail,
      changeEmailToken,
    });
  }

  verifyNewEmail(code: string, changeEmailToken: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/change-email/verify-new`, {
      code,
      changeEmailToken,
    });
  }

  // --- Direct Email Change (2 Steps) ---
  requestChangeEmail(newEmail: string): Observable<any> {
    console.log('[AuthService] Requesting email change to:', newEmail);
    return this.http.post(`${this.apiUrl}/change-email/request`, { newEmail });
  }

  verifyChangeEmail(newEmail: string, code: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/change-email/verify`, {
      newEmail,
      code,
    });
  }

  // --- Account Deletion ---

  requestDeletion(): Observable<any> {
    return this.http.post(`${this.userApiUrl}/delete-request`, {});
  }

  cancelDeletion(): Observable<any> {
    return this.http.post(`${this.userApiUrl}/cancel-delete-request`, {}).pipe(
      tap((response: any) => {
        // Refresh local user state
        this.getMe().subscribe();
      })
    );
  }

  getDeletionPrecheck(): Observable<any> {
    return this.http.get(`${this.userApiUrl}/deletion-precheck`);
  }

  restoreAccount(data: any): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${this.apiUrl}/restore`, data).pipe(
      tap((response) => {
        if (response.user) {
          this.currentUserSubject.next(response.user);
        }
      }),
    );
  }

  handleLoginSuccess(response: any) {
    if (response.user) {
      this.currentUserSubject.next(response.user);
    }
  }
}
