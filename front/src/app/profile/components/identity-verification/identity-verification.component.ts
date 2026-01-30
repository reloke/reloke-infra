import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject, takeUntil } from 'rxjs';
import { IdentityService, KycStatusResponse } from '../../../core/services/identity.service';
import { AlertComponent } from '../../../shared/components/alert/alert.component';

import { ActivatedRoute } from '@angular/router';

@Component({
    selector: 'app-identity-verification',
    standalone: true,
    imports: [CommonModule, AlertComponent],
    templateUrl: './identity-verification.component.html'
})
export class IdentityVerificationComponent implements OnInit, OnDestroy {
    private destroy$ = new Subject<void>();

    status: 'UNVERIFIED' | 'PENDING' | 'PROCESSING' | 'VERIFIED' | 'REQUIRES_INPUT' | 'CANCELED' | 'REJECTED' | 'DECLINED' = 'UNVERIFIED';
    kycReason: string | null = null;
    isVerified = false;
    verifiedAt: Date | null = null;
    isLoading = false;
    error: string | null = null;
    successMessage: string | null = null;

    constructor(
        private identityService: IdentityService,
        private route: ActivatedRoute
    ) { }

    ngOnInit() {
        this.loadStatus();

        // Handle Didit callback
        this.route.queryParams
            .pipe(takeUntil(this.destroy$))
            .subscribe(params => {
                const status = params['status'];
                if (status === 'Approved') {
                    this.successMessage = 'Votre vérification d\'identité a été complétée avec succès !';
                } else if (status === 'Abandoned' || status === 'Declined') {
                    this.error = 'La vérification d\'identité a échoué ou a été abandonnée.';
                }
            });
    }

    ngOnDestroy() {
        this.destroy$.next();
        this.destroy$.complete();
    }

    /**
     * Load current KYC status from the server
     */
    loadStatus() {
        this.identityService.getStatus()
            .pipe(takeUntil(this.destroy$))
            .subscribe({
                next: (response) => {
                    this.status = response.kycStatus;
                    this.kycReason = response.kycReason || null;
                    this.isVerified = response.isVerified;
                    this.verifiedAt = response.verifiedAt ? new Date(response.verifiedAt) : null;
                },
                error: (err) => {
                    console.error('Error loading KYC status:', err);
                }
            });
    }

    /**
     * Start verification with Didit
     * Opens the Didit verification URL in a new window or redirects
     */
    startVerification() {
        this.isLoading = true;
        this.error = null;

        this.identityService.startVerification()
            .pipe(takeUntil(this.destroy$))
            .subscribe({
                next: (response) => {
                    this.isLoading = false;
                    if (response.verificationUrl) {
                        // Option 1: Redirect to Didit
                        window.location.href = response.verificationUrl;

                        // Option 2: Open in new tab (uncomment if preferred)
                        // window.open(response.verificationUrl, '_blank');
                        // this.status = 'PROCESSING';
                    }
                },
                error: (err) => {
                    this.isLoading = false;
                    const message = err.error?.message || 'Impossible de lancer la vérification. Veuillez réessayer.';
                    this.error = message;
                    console.error('Error starting verification:', err);
                }
            });
    }

    /**
     * Dismiss error alert
     */
    dismissError() {
        this.error = null;
    }

    /**
     * Dismiss success alert
     */
    dismissSuccess() {
        this.successMessage = null;
    }

    /**
     * Get human-readable status text
     */
    getStatusText(): string {
        switch (this.status) {
            case 'UNVERIFIED':
                return 'Non vérifié';
            case 'PROCESSING':
                return 'Vérification en cours';
            case 'VERIFIED':
                return 'Identité vérifiée';
            case 'REQUIRES_INPUT':
                return 'Action requise';
            case 'CANCELED':
                return 'Vérification annulée';
            case 'DECLINED':
                return 'Identité refusée';
            default:
                return 'Statut inconnu';
        }
    }

    /**
     * Get status description
     */
    getStatusDescription(): string {
        switch (this.status) {
            case 'UNVERIFIED':
                return 'Vérifiez votre identité pour débloquer toutes les fonctionnalités d\'échange.';
            case 'PROCESSING':
                return 'Votre vérification est en cours de traitement. Cela peut prendre quelques minutes.';
            case 'VERIFIED':
                return 'Félicitations ! Vous pouvez maintenant échanger en toute confiance.';
            case 'REQUIRES_INPUT':
                return 'La vérification a échoué. Veuillez réessayer avec un document valide.';
            case 'CANCELED':
                return 'La vérification a été annulée ou a expiré. Veuillez réessayer.';
            case 'DECLINED':
                return this.kycReason || 'Votre vérification d\'identité a été refusée.';
            default:
                return '';
        }
    }

    /**
     * Check if the user can retry verification
     */
    canRetry(): boolean {
        return this.status === 'UNVERIFIED' || this.status === 'REQUIRES_INPUT' || this.status === 'CANCELED' || this.status === 'DECLINED';
    }
}
