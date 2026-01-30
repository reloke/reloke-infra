import { bootstrapApplication } from '@angular/platform-browser';

import { AppComponent } from './app/app.component';
import { appConfigServer } from './app/app.config.server';

export default function bootstrap() {
  return bootstrapApplication(AppComponent, appConfigServer);
}

