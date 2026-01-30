import { Component, OnInit, OnDestroy } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { SharedModule } from './shared/shared.module';
import { SessionService } from './core/services/session.service';
import { AuthService } from './core/services/auth.service';
import { Subscription } from 'rxjs';
import { CommonModule } from '@angular/common';
import { NotificationService } from './core/notifications/notification.service';
import { ConnectivityService } from './core/services/connectivity.service';
import { GlobalStatusComponent } from './shared/components/global-status/global-status.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, SharedModule, CommonModule, GlobalStatusComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent implements OnInit, OnDestroy {
  title = 'Reloke';
  showSessionTimeoutModal = false;
  private sessionSubscription: Subscription | undefined;

  constructor(
    private sessionService: SessionService,
    private authService: AuthService,
    private connectivityService: ConnectivityService,
    private notificationService: NotificationService
  ) { }

  ngOnInit() {
    this.sessionSubscription = this.sessionService.sessionExpired$.subscribe(() => {
      this.showSessionTimeoutModal = true;
    });
  }

  onSessionTimeoutClose() {
    this.showSessionTimeoutModal = false;
    this.authService.logout();
  }

  ngOnDestroy() {
    if (this.sessionSubscription) {
      this.sessionSubscription.unsubscribe();
    }
  }
}

