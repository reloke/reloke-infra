import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { GlobalErrorService } from '../services/global-error.service';

export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const globalErrorService = inject(GlobalErrorService);

  return next(req).pipe(
    catchError((error: HttpErrorResponse) => {
      // Check for 500 Server Error (or strictly 500 as requested, or 5xx range)
      // Request says "catches all 500 errors" -> usually means 5xx or literally 500. 
      // Let's stick to 5xx to be safe, or just 500? "toutes les erreurs HTTP 500" implies 500 family.
      // But typically "Server Down" implies 500, 502, 503, 504.
      if (error.status >= 500) {
        // Exclude specific calls if needed (e.g. background polling), but requirement is global.
        globalErrorService.setServerDown(true);
      }
      return throwError(() => error);
    })
  );
};
