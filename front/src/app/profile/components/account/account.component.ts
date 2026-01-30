import { Component, OnInit } from '@angular/core';
import { CommonModule, registerLocaleData } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { AuthService, User } from '../../../core/services/auth.service';
import { UserService } from '../../../core/services/user.service';
import { SharedModule } from 'src/app/shared/shared.module';
import { EmailChangeModalComponent } from './email-change-modal/email-change-modal.component';
import { IdentityService } from '../../../core/services/identity.service';
import { Subject, interval } from 'rxjs';
import { takeUntil, filter, switchMap } from 'rxjs/operators';
import localeFr from '@angular/common/locales/fr';

registerLocaleData(localeFr, 'fr-FR');

import { KycButtonComponent } from '../../../shared/components/kyc-button/kyc-button.component';
import { DossierFacileModalComponent } from './dossier-facile-modal/dossier-facile-modal.component';
import { DossierFacileService } from '../../../core/services/dossier-facile.service';

import { ActivatedRoute } from '@angular/router';
import { NotificationService } from '../../../core/services/notification.service';

@Component({
    selector: 'app-account',
    standalone: true,
    imports: [CommonModule, ReactiveFormsModule, SharedModule, EmailChangeModalComponent, KycButtonComponent, DossierFacileModalComponent],
    templateUrl: './account.component.html',
})
export class AccountComponent implements OnInit {
    user: User | null = null;
    private destroy$ = new Subject<void>();

    // Modals state
    isNameModalOpen = false;
    isEmailModalOpen = false;
    isDossierModalOpen = false;

    // Forms
    nameForm: FormGroup;
    isSubmitting = false;

    successMessage: string | null = null;
    errorMessage: string | null = null;

    constructor(
        private fb: FormBuilder,
        private authService: AuthService,
        private userService: UserService,
        private identityService: IdentityService,
        private dfService: DossierFacileService,
        private route: ActivatedRoute,
        private notificationService: NotificationService
    ) {
        this.nameForm = this.fb.group({
            firstName: ['', [Validators.required, Validators.minLength(2)]],
            lastName: ['', [Validators.required, Validators.minLength(2)]]
        });
    }

    ngOnInit() {
        this.authService.currentUser$
            .pipe(takeUntil(this.destroy$))
            .subscribe(u => {
                this.user = u;
            });

        // Check for Didit callback params
        this.route.queryParams
            .pipe(takeUntil(this.destroy$))
            .subscribe(params => {
                const status = params['status'];
                if (status === 'Approved') {
                    // Force refresh from server to catch the webhook update
                    this.authService.getMe().subscribe(user => {
                        if (user && user.isKycVerified) {
                            this.successMessage = 'Votre vérification d\'identité a été complétée avec succès !';
                            this.errorMessage = null;
                        } else if (user && user.kycStatus === 'REJECTED') {
                            this.errorMessage = user.kycReason || 'La vérification d\'identité a été refusée.';
                            this.successMessage = null;
                        }
                    });
                } else if (status === 'Abandoned' || status === 'Declined' || status === 'Rejected') {
                    this.errorMessage = 'La vérification d\'identité a échoué ou a été abandonnée.';
                    this.successMessage = null;
                }
            });

        // Polling logic for KYC status
        interval(15000) // 15 seconds
            .pipe(
                takeUntil(this.destroy$),
                filter(() => this.user?.kycStatus === 'PENDING'),
                switchMap(() => this.authService.getMe())
            )
            .subscribe();
    }

    ngOnDestroy() {
        this.destroy$.next();
        this.destroy$.complete();
    }

    // --- Section A: Personal Info ---
    openNameModal() {
        if (this.user?.isKycVerified) return;

        if (this.user) {
            this.nameForm.patchValue({
                firstName: this.user.firstName,
                lastName: this.user.lastName
            });
            this.isNameModalOpen = true;
        }
    }

    closeNameModal() {
        this.isNameModalOpen = false;
    }

    updateName() {
        console.log('[AccountComponent] updateName called');
        console.log('[AccountComponent] Form valid:', this.nameForm.valid);
        console.log('[AccountComponent] isSubmitting:', this.isSubmitting);

        if (this.nameForm.invalid || this.isSubmitting) {
            console.warn('[AccountComponent] updateName exit early');
            return;
        }

        this.isSubmitting = true;
        this.errorMessage = null;
        this.successMessage = null;

        this.userService.updateProfile(this.nameForm.value).subscribe({
            next: () => {
                this.authService.updateCurrentUser(this.nameForm.value);
                this.isSubmitting = false;
                this.successMessage = 'Vos informations ont été mises à jour avec succès.';
                this.closeNameModal();
            },
            error: (err) => {
                console.error('Update failed', err);
                this.errorMessage = err.error?.message || 'Une erreur est survenue lors de la mise à jour.';
                this.isSubmitting = false;
            }
        });
    }

    // --- Section B: Email ---
    openEmailModal() {
        this.isEmailModalOpen = true;
    }

    onEmailModalClose() {
        this.isEmailModalOpen = false;
    }

    onEmailChanged(newEmail: string) {
        // Logout on success
        this.authService.logout();
    }

    onKycStarted() {
        // Force a refresh to update kycStatus to 'PROCESSING' and start polling
        this.authService.getMe().subscribe();
    }

    openDossierModal() {
        console.log('[AccountComponent] Opening DossierFacile modal');
        this.isDossierModalOpen = true;
    }

    closeDossierModal() {
        this.isDossierModalOpen = false;
    }

    onDossierSaved() {
        // Refresh user data from server to get new DossierFacile state
        this.authService.getMe().subscribe(u => {
            if (u && u.dossierFacileUrl && !u.dossierFacileUrl.startsWith('http')) {
                u.dossierFacileUrl = 'https://' + u.dossierFacileUrl;
            }
        });
        this.successMessage = 'Votre lien DossierFacile a été mis à jour.';
    }

    get normalizedDossierUrl(): string | null {
        if (!this.user?.dossierFacileUrl) return null;
        let url = this.user.dossierFacileUrl;
        if (!url.startsWith('http')) {
            return 'https://' + url;
        }
        return url;
    }

    get kycErrorReasons(): string[] {
        if (!this.user?.kycReason) return ['Veuillez réessayer la vérification.'];

        return this.user.kycReason.split('|').map(code => {
            const trimmed = code.trim();
            if (trimmed.startsWith('MINIMUM_AGE_NOT_MET')) {
                const limit = trimmed.split(':')[1] || '18';
                return `L'âge minimum requis est de ${limit} ans.`;
            }
            if (trimmed === 'POSSIBLE_DUPLICATED_USER') return "Un compte vérifié existe déjà avec ces informations.";
            if (trimmed === 'DOC_EXPIRED') return "Votre document d'identité a expiré.";
            if (trimmed === 'POOR_QUALITY') return "La qualité de l'image est insuffisante.";
            if (trimmed === 'NO_FACE_DETECTED') return "Aucun visage détecté. Assurez-vous d'être bien face caméra.";
            if (trimmed === 'LOW_FACE_MATCH_SIMILARITY') return "Votre visage ne correspond pas suffisamment à la photo du document.";
            if (trimmed === 'VERIFICATION_FAILED') return "La vérification a échoué.";

            // Fallback: If it contains spaces, assume it's a legacy sentence/reason
            // Otherwise, display a generic message with the code for support
            return trimmed.includes(' ') ? trimmed : `Problème de vérification (${trimmed})`;
        });
    }

    goToDossier(event: Event) {
        event.preventDefault();
        event.stopPropagation();
        const url = this.normalizedDossierUrl;
        console.log('[AccountComponent] Manual redirection to:', url);
        if (url) {
            window.open(url, '_blank', 'noopener,noreferrer');
        }
    }

    async togglePushNotifications() {
        if (!this.user) return;

        const newStatus = !this.user.pushEnabled;

        if (newStatus) {
            // Trying to enable
            const success = await this.notificationService.subscribeToPush();
            if (success) {
                this.authService.updateCurrentUser({ pushEnabled: true });
                this.successMessage = 'Notifications push activées avec succès.';
            } else {
                this.errorMessage = 'Impossible d\'activer les notifications. Veuillez vérifier les permissions de votre navigateur.';
            }
        } else {
            // Trying to disable
            this.userService.updatePushSettings(false).subscribe({
                next: () => {
                    this.authService.updateCurrentUser({ pushEnabled: false });
                    this.successMessage = 'Notifications push désactivées.';
                },
                error: (err) => {
                    console.error('Failed to disable push', err);
                    this.errorMessage = 'Une erreur est survenue lors de la désactivation.';
                }
            });
        }
    }
}
