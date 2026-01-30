import { Component, OnInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Subject } from 'rxjs';
import { takeUntil, filter } from 'rxjs/operators';
import {
  MatchingService,
  MatchingSummary,
  MatchStatusSummary,
} from '../../../matching/services/matching.service';
import { MatchingStoreService } from '../../../matching/services/matching-store.service';
import { NotificationPermissionPromptService } from '../../../core/notifications/notification-permission-prompt/notification-permission-prompt.service';

@Component({
  selector: 'app-match-status',
  templateUrl: './match-status.component.html',
  styleUrls: ['./match-status.component.scss'],
})
export class MatchStatusComponent implements OnInit, OnDestroy {
  summary: MatchingSummary | null = null;
  statusSummary: MatchStatusSummary | null = null;
  isLoading = true;
  isRefunding = false;
  showRefundConfirm = false;

  // Cooldown countdown display (updated every second)
  cooldownDisplay: string | null = null;

  private destroy$ = new Subject<void>();

  constructor(
    private matchingService: MatchingService,
    private matchingStore: MatchingStoreService,
    private router: Router,
    private snackBar: MatSnackBar,
    private notificationPromptService: NotificationPermissionPromptService
  ) {}

  ngOnInit(): void {
    this.matchingStore.status$
      .pipe(
        takeUntil(this.destroy$),
        filter((status): status is MatchStatusSummary => status !== null)
      )
      .subscribe((status) => {
        this.statusSummary = status;
        // Evaluate notification permission prompt eligibility
        this.notificationPromptService.evaluateAndShow(status.totalMatchesRemaining);
      });
    this.matchingStore
      .refreshStatus()
      .pipe(takeUntil(this.destroy$))
      .subscribe();
    this.loadSummary();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private loadSummary(): void {
    this.isLoading = true;
    this.matchingService
      .getMatchingSummary()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (summary) => {
          this.summary = summary;
          this.isLoading = false;
          // Update cooldown display immediately after loading
          this.updateCooldownDisplay();
        },
        error: () => {
          this.summary = null;
          this.isLoading = false;
        },
      });
  }



  /**
   * Update the cooldown display string based on remaining time
   */
  private updateCooldownDisplay(): void {
    if (!this.summary?.refundCooldownUntil) {
      this.cooldownDisplay = null;
      return;
    }

    const endTime = new Date(this.summary.refundCooldownUntil).getTime();
    const now = Date.now();
    const remainingMs = endTime - now;

    if (remainingMs <= 0) {
      this.cooldownDisplay = null;
      return;
    }

    // Format as "X jours Y heures" or "X heures Y minutes"
    this.cooldownDisplay = this.formatDuration(remainingMs);
  }

  /**
   * Navigate to payment page, but check for cooldown first
   */
  buyMoreMatches(): void {
    // Block navigation if user is in refund cooldown period
    if (this.summary && !this.summary.canBuyNewPack) {
      const message =
        this.summary.blockingReason === 'REFUND_COOLDOWN_ACTIVE'
          ? `Vous ne pouvez pas acheter un nouveau pack pendant la période de cooldown (${
              this.cooldownDisplay || 'en cours'
            }).`
          : 'Achat temporairement indisponible.';
      this.snackBar.open(message, 'Fermer', {
        duration: 5000,
        panelClass: ['custom-snackbar-action-error'],
      });
      return;
    }
    this.router.navigate(['/matching/payment']);
  }

  /**
   * Open refund confirmation modal, but check for blocking conditions first
   */
  openRefundConfirm(): void {
    // Block if matching is in progress
    if (this.summary?.isRefundBlockedByMatching) {
      this.snackBar.open(
        'Remboursement temporairement indisponible : un traitement de matching est en cours. Réessayez dans quelques minutes.',
        'Fermer',
        { duration: 6000, panelClass: ['custom-snackbar-action-error'] }
      );
      return;
    }
    this.showRefundConfirm = true;
  }

  closeRefundConfirm(): void {
    this.showRefundConfirm = false;
  }

  confirmRefund(): void {
    if (!this.summary?.refundEligible || this.isRefunding) return;

    this.isRefunding = true;
    this.matchingService
      .requestRefund()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          this.isRefunding = false;
          this.showRefundConfirm = false;
          this.snackBar.open(
            `Remboursement de ${this.formatPrice(
              response.refundedAmount
            )} € effectué avec succès.`,
            'Fermer',
            { duration: 5000, panelClass: ['custom-snackbar-action-success'] }
          );

          setTimeout(() => {
            this.matchingStore.refreshStatus().pipe(takeUntil(this.destroy$)).subscribe();
            this.loadSummary();
          }, 1000);
        },
        error: (err) => {
          this.isRefunding = false;
          this.showRefundConfirm = false;
          this.snackBar.open(
            err.message || 'Erreur lors du remboursement.',
            'Fermer',
            { duration: 4000, panelClass: ['custom-snackbar-action-error'] }
          );
        },
      });
  }

  formatPrice(price: number): string {
    return price.toFixed(2).replace('.', ',');
  }

  get hasCredits(): boolean {
    return this.totalNetMatches > 0;
  }

  get progressPercent(): number {
    if (this.totalNetMatches === 0) return 0;
    return (this.creditsUsed / this.totalNetMatches) * 100;
  }

  get totalNetMatches(): number {
    return this.creditsUsed + this.creditsRemaining;
  }

  get creditsRemaining(): number {
    return this.statusSummary?.totalMatchesRemaining ?? this.summary?.totalMatchesRemaining ?? 0;
  }

  get creditsUsed(): number {
    return this.statusSummary?.totalMatchesUsed ?? this.summary?.totalMatchesUsed ?? 0;
  }

  /**
   * Check if refund cooldown is currently active
   */
  get isCooldownActive(): boolean {
    if (!this.summary?.refundCooldownUntil) return false;
    return new Date(this.summary.refundCooldownUntil).getTime() > Date.now();
  }

  /**
   * Check if user can currently buy a new pack
   */
  get canBuyPack(): boolean {
    return this.summary?.canBuyNewPack !== false;
  }

  /**
   * Format duration in milliseconds to human-readable French string
   * Examples: "13 jours 5 heures", "2 heures 30 minutes", "45 minutes"
   */
  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      const remainingHours = hours % 24;
      return `${days} jour${days > 1 ? 's' : ''} ${remainingHours} heure${
        remainingHours > 1 ? 's' : ''
      }`;
    } else if (hours > 0) {
      const remainingMinutes = minutes % 60;
      return `${hours} heure${hours > 1 ? 's' : ''} ${remainingMinutes} minute${
        remainingMinutes > 1 ? 's' : ''
      }`;
    } else {
      return `${minutes} minute${minutes > 1 ? 's' : ''}`;
    }
  }
}
