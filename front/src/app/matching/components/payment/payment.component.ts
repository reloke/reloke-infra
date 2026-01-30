import { Component, OnInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { MatchingService, PackInfo } from '../../services/matching.service';
import { AuthService, User } from '../../../core/services/auth.service';
import { IdentityService } from '../../../core/services/identity.service';

@Component({
  selector: 'app-payment',
  templateUrl: './payment.component.html',
  styleUrls: ['./payment.component.scss'],
})
export class PaymentComponent implements OnInit, OnDestroy {
  packs: PackInfo[] = [];
  isLoading = false;
  isLoadingPacks = true;
  selectedPack: PackInfo | null = null;

  // KYC verification modal
  showKycModal = false;
  isStartingKyc = false;

  private destroy$ = new Subject<void>();

  constructor(
    private matchingService: MatchingService,
    private router: Router,
    private snackBar: MatSnackBar,
    private authService: AuthService,
    private identityService: IdentityService
  ) { }

  ngOnInit(): void {
    this.loadPacks();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private loadPacks(): void {
    this.isLoadingPacks = true;
    this.matchingService
      .getAvailablePacks()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (packs) => {
          this.packs = packs;
          this.isLoadingPacks = false;
        },
        error: (err) => {
          this.isLoadingPacks = false;
          this.snackBar.open(
            err.message || 'Erreur lors du chargement des packs.',
            'Fermer',
            { duration: 4000, panelClass: ['custom-snackbar-action-error'] }
          );
        },
      });
  }

  selectPack(pack: PackInfo): void {
    if (this.isLoading) return;

    // Check if user account is validated (KYC)
    const user = this.authService.getCurrentUser();
    if (!user?.isKycVerified) {
      this.selectedPack = pack;
      this.showKycModal = true;
      return;
    }

    this.proceedToCheckout(pack);
  }

  private proceedToCheckout(pack: PackInfo): void {
    this.selectedPack = pack;
    this.isLoading = true;

    this.matchingService
      .createCheckoutSession(pack.planType)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          // Redirect to Stripe Checkout
          window.location.href = response.url;
        },
        error: (err) => {
          this.isLoading = false;
          this.selectedPack = null;
          this.snackBar.open(
            err.message || 'Erreur lors de la creation du paiement.',
            'Fermer',
            { duration: 4000, panelClass: ['custom-snackbar-action-error'] }
          );
        },
      });
  }

  // ============================================================
  // KYC Modal Methods
  // ============================================================

  closeKycModal(): void {
    this.showKycModal = false;
    this.selectedPack = null;
  }

  startKyc(): void {
    if (this.isStartingKyc) return;

    this.isStartingKyc = true;
    this.identityService
      .startVerification()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          this.isStartingKyc = false;
          this.showKycModal = false;
          // Redirect to Didit verification URL
          if (response.verificationUrl) {
            window.location.href = response.verificationUrl;
          }
        },
        error: (err) => {
          this.isStartingKyc = false;
          this.snackBar.open(
            err.error?.message || 'Erreur lors du démarrage de la vérification.',
            'Fermer',
            { duration: 4000, panelClass: ['custom-snackbar-action-error'] }
          );
        },
      });
  }

  goBack(): void {
    this.router.navigate(['/dashboard']);
  }

  formatPrice(price: number): string {
    return price.toFixed(2).replace('.', ',');
  }
}
