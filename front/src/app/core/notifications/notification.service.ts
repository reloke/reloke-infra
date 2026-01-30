import { Injectable } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ConnectivityService } from '../services/connectivity.service';
import { Subscription } from 'rxjs';

export interface LocalNotificationPayload {
  title: string;
  body: string;
  icon?: string;
  data?: { url?: string };
  bypassQueue?: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class NotificationService {
  private notificationQueue: LocalNotificationPayload[] = [];
  private connectivitySubscription: Subscription;

  constructor(
    private snackBar: MatSnackBar,
    private connectivityService: ConnectivityService
  ) {
    this.connectivitySubscription = this.connectivityService.isOnline$.subscribe(online => {
      if (online && this.notificationQueue.length > 0) {
        this.processQueue();
      }
    });
  }

  requestPermission(): Promise<NotificationPermission> {
    if (!this.isNotificationSupported()) {
      return Promise.resolve('denied');
    }
    return Notification.requestPermission();
  }

  canNotify(): boolean {
    return this.isNotificationSupported() && Notification.permission === 'granted';
  }

  notify(payload: LocalNotificationPayload): void {
    if (!this.connectivityService.isOnline && !payload.bypassQueue) {
      this.notificationQueue.push(payload);
      return;
    }

    const options: NotificationOptions = {
      body: payload.body,
      icon: payload.icon,
      data: payload.data,
    };

    if (this.canNotify()) {
      try {
        const notification = new Notification(payload.title, options);
        notification.onclick = () => {
          const targetUrl = payload.data?.url;
          if (targetUrl) {
            window.open(targetUrl, '_blank');
          }
        };
        return;
      } catch {
        // Fall through to snackbar when Notification constructor fails.
      }
    }

    this.showSnack(payload.body);
  }

  private showSnack(message: string): void {
    this.snackBar.open(message, 'Fermer', {
      duration: 4000,
      panelClass: ['custom-snackbar-action-notif'],
    });
  }

  private isNotificationSupported(): boolean {
    return typeof window !== 'undefined' && 'Notification' in window;
  }

  private processQueue(): void {
    const currentQueue = [...this.notificationQueue];
    this.notificationQueue = [];
    currentQueue.forEach(payload => {
      this.notify(payload);
    });
  }

  ngOnDestroy() {
    if (this.connectivitySubscription) {
      this.connectivitySubscription.unsubscribe();
    }
  }
}
