import { ApplicationConfig } from '@angular/core';
import { provideServerRendering } from '@angular/platform-server';

import { appConfig } from './app.config';

export const appConfigServer: ApplicationConfig = {
  providers: [provideServerRendering(), ...(appConfig.providers ?? [])],
};

