import { ApplicationConfig, importProvidersFrom, APP_INITIALIZER, PLATFORM_ID } from '@angular/core';
import { provideRouter, withInMemoryScrolling } from '@angular/router';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { provideAnimations } from '@angular/platform-browser/animations';
import { isPlatformBrowser } from '@angular/common';
import { firstValueFrom } from 'rxjs';

import { routes } from './app.routes';
import { CoreModule } from './core/core.module';
import { AuthService } from './core/services/auth.service';
import { SeoService } from './seo/seo.service';

function initializeApp(authService: AuthService, platformId: object) {
  return () => {
    if (!isPlatformBrowser(platformId)) return;
    return firstValueFrom(authService.getMe());
  };
}

function initializeSeo(seoService: SeoService) {
  return () => seoService.init();
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes, withInMemoryScrolling({ anchorScrolling: 'enabled', scrollPositionRestoration: 'enabled' })),
    provideHttpClient(withInterceptorsFromDi()),
    provideAnimations(),
    importProvidersFrom(CoreModule),
    {
      provide: APP_INITIALIZER,
      useFactory: initializeApp,
      deps: [AuthService, PLATFORM_ID],
      multi: true
    },
    {
      provide: APP_INITIALIZER,
      useFactory: initializeSeo,
      deps: [SeoService],
      multi: true
    },
    provideAnimations()
  ]
};
