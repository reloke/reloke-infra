import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { environment } from 'src/environments/environment';
import { SharedModule } from 'src/app/shared/shared.module';

@Component({
  selector: 'app-policy',
  standalone: true,
  imports: [RouterLink, SharedModule],
  templateUrl: './policy.component.html',
  styleUrl: './policy.component.scss'
})
export class PolicyComponent {
  public readonly lastUpdated: string =
    (environment as any)?.policyLastUpdated ?? 'À compléter';
}
