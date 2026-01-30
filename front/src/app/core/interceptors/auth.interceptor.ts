import { Injectable } from '@angular/core';
import {
  HttpRequest,
  HttpHandler,
  HttpEvent,
  HttpInterceptor,
  HttpErrorResponse
} from '@angular/common/http';
import { Observable, throwError, BehaviorSubject, filter, take, switchMap, catchError, finalize } from 'rxjs';
import { Router } from '@angular/router';
import { AuthService } from '../services/auth.service'; // Ensure no circular dependency or use Injector if needed
import { SessionService } from '../services/session.service';

@Injectable()
export class AuthInterceptor implements HttpInterceptor {
  private isRefreshing = false;
  private refreshTokenSubject: BehaviorSubject<any> = new BehaviorSubject<any>(null);

  constructor(
    private router: Router,
    private authService: AuthService,
    private sessionService: SessionService
  ) { }

  intercept(request: HttpRequest<unknown>, next: HttpHandler): Observable<HttpEvent<unknown>> {
    const authReq = request.clone({
      withCredentials: true
    });

    return next.handle(authReq).pipe(
      catchError((error: HttpErrorResponse) => {

        if (error.status === 401) {
          // Check if request has header to skip redirect/refresh logic (e.g. login itself, or initial check)
          if (request.headers.has('X-Skip-Interceptor')) {
            return throwError(() => error);
          }
          // Avoid infinite loop if refresh endpoint itself returns 401
          if (request.url.includes('/refresh')) {
            // Refresh failed -> Session Timeout
            this.sessionService.notifySessionExpired();
            return throwError(() => error);
          }

          return this.handle401Error(authReq, next);
        }
        return throwError(() => error);
      })
    );
  }

  private handle401Error(request: HttpRequest<any>, next: HttpHandler) {
    if (!this.isRefreshing) {
      this.isRefreshing = true;
      this.refreshTokenSubject.next(null);

      return this.authService.refreshToken().pipe(
        switchMap((response: any) => {
          this.isRefreshing = false;
          this.refreshTokenSubject.next(response); // Emit value to unblock waiting requests
          return next.handle(request); // Retry original request
        }),
        catchError((err) => {
          this.isRefreshing = false;
          // Refresh failed -> Session Timeout
          this.sessionService.notifySessionExpired();
          return throwError(() => err);
        })
      );
    } else {
      // Wait for token refresh
      return this.refreshTokenSubject.pipe(
        filter(token => token != null),
        take(1),
        switchMap(jwt => {
          // Retry original request
          return next.handle(request);
        })
      );
    }
  }
}
