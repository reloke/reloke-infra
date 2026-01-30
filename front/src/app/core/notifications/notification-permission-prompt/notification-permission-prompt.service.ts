import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { NotificationService } from '../../services/notification.service';

interface PromptState {
  accepted: boolean;
  denied: boolean;
  neverAsk: boolean;
  lastDismissedAt: number | null;
}

const STORAGE_KEY = 'notification_permission_prompt';
const COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours

@Injectable({
  providedIn: 'root',
})
export class NotificationPermissionPromptService {
  private readonly showPromptSubject = new BehaviorSubject<boolean>(false);
  readonly showPrompt$: Observable<boolean> = this.showPromptSubject.asObservable();

  private readonly permissionChangedSubject = new BehaviorSubject<void>(undefined);
  readonly permissionStatus$: Observable<void> = this.permissionChangedSubject.asObservable();

  private state: PromptState = {
    accepted: false,
    denied: false,
    neverAsk: false,
    lastDismissedAt: null,
  };

  constructor(private notificationService: NotificationService) {
    this.loadState();
  }

  /**
   * Check eligibility and show prompt if conditions are met.
   * Should be called when:
   * - Notification API is supported
   * - Permission is 'default'
   * - User has credits remaining > 0
   */
  evaluateAndShow(creditsRemaining: number): void {
    if (!this.isNotificationSupported()) {
      return;
    }

    const permission = (window as any).Notification?.permission;
    if (permission !== 'default') {
      // Permission already granted or denied, no need to show prompt
      this.showPromptSubject.next(false);
      return;
    }

    if (creditsRemaining <= 0) {
      this.showPromptSubject.next(false);
      return;
    }

    if (this.state.accepted || this.state.denied || this.state.neverAsk) {
      this.showPromptSubject.next(false);
      return;
    }

    if (this.isInCooldown()) {
      this.showPromptSubject.next(false);
      return;
    }

    this.showPromptSubject.next(true);
  }

  /**
   * User clicked "Autoriser" - request browser permission
   */
  async requestPermission(): Promise<NotificationPermission> {
    if (!this.isNotificationSupported()) {
      return 'denied';
    }

    try {
      const permission = await Notification.requestPermission();

      if (permission === 'granted') {
        this.state.accepted = true;
        this.saveState();
        // Trigger push subscription
        await this.notificationService.subscribeToPush();
      } else if (permission === 'denied') {
        this.state.denied = true;
        this.saveState();
      } else {
        // Permission stayed 'default' (user dismissed without choosing)
        this.setCooldown();
      }

      this.showPromptSubject.next(false);
      this.permissionChangedSubject.next();
      return permission;
    } catch (error) {
      console.error('[NotificationPermissionPrompt] Error requesting permission:', error);
      this.setCooldown();
      this.showPromptSubject.next(false);
      this.permissionChangedSubject.next();
      return 'default';
    }
  }

  /**
   * User clicked "Plus tard" - hide and set cooldown
   */
  dismissLater(): void {
    this.setCooldown();
    this.showPromptSubject.next(false);
    this.permissionChangedSubject.next();
  }

  /**
   * User clicked "Ne plus demander" - permanently hide
   */
  dismissForever(): void {
    this.state.neverAsk = true;
    this.saveState();
    this.showPromptSubject.next(false);
    this.permissionChangedSubject.next();
  }

  /**
   * Hide the prompt (e.g., on component destroy)
   */
  hide(): void {
    this.showPromptSubject.next(false);
  }

  /**
   * Explicitly show the prompt (e.g., when clicking a button)
   */
  showPrompt(): void {
    if (this.isNotificationSupported() && Notification.permission !== 'granted') {
      this.showPromptSubject.next(true);
    }
  }

  get isPermissionGranted(): boolean {
    if (!this.isNotificationSupported()) return false;
    return (window as any).Notification?.permission === 'granted';
  }

  get isDenied(): boolean {
    if (!this.isNotificationSupported()) return false;
    return (window as any).Notification?.permission === 'denied';
  }

  get canRequestPermission(): boolean {
    if (!this.isNotificationSupported()) return false;
    return (window as any).Notification?.permission === 'default';
  }

  private isNotificationSupported(): boolean {
    return typeof window !== 'undefined' && 'Notification' in window;
  }

  private isInCooldown(): boolean {
    if (!this.state.lastDismissedAt) {
      return false;
    }
    const elapsed = Date.now() - this.state.lastDismissedAt;
    return elapsed < COOLDOWN_MS;
  }

  private setCooldown(): void {
    this.state.lastDismissedAt = Date.now();
    this.saveState();
  }

  private loadState(): void {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<PromptState>;
        this.state = {
          accepted: parsed.accepted ?? false,
          denied: parsed.denied ?? false,
          neverAsk: parsed.neverAsk ?? false,
          lastDismissedAt: parsed.lastDismissedAt ?? null,
        };
      }
    } catch (error) {
      console.warn('[NotificationPermissionPrompt] Failed to load state from localStorage:', error);
    }
  }

  private saveState(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch (error) {
      console.warn('[NotificationPermissionPrompt] Failed to save state to localStorage:', error);
    }
  }
}
