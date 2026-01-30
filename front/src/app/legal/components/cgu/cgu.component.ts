import { Component } from '@angular/core';
import { environment } from 'src/environments/environment';

@Component({
  selector: 'app-cgu',
  templateUrl: './cgu.component.html'
})
export class CguComponent {
  public readonly lastUpdated: string =
    (environment as any)?.policyLastUpdated ?? 'À compléter';
  public readonly cguVersion: string = (environment as any)?.CGU_VERSION || '1.0';
}
