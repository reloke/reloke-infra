import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { SharedModule } from '../../../shared/shared.module';
import { AlertType } from '../../../shared/components/alert/alert.component';
import { UserService } from '../../../core/services/user.service';
import { AuthService } from '../../../core/services/auth.service';
import { Router } from '@angular/router';

import { MatSnackBar } from '@angular/material/snack-bar';
import { saveAs } from 'file-saver';

@Component({
    selector: 'app-data-privacy',
    standalone: true,
    imports: [CommonModule, ReactiveFormsModule, SharedModule],
    templateUrl: './data-privacy.component.html'
})
export class DataPrivacyComponent {
    isExporting = false;
    isDeleteModalOpen = false;
    deleteForm: FormGroup;
    currentUserEmail = '';
    currentUserNames = { first: '', last: '' };
    isLoading = false;

    // Pre-deletion check state
    deletionPrecheck = {
        isInFlow: false,
        hasCredits: false,
        remainingCredits: 0
    };
    isCheckingDeletion = false;

    // Confirmation Modals State
    isConfirmationOpen = false;
    isCancelConfirmationOpen = false;

    confirmationTitle = 'Confirmer la suppression';
    confirmationMessage = 'Êtes-vous sûr de vouloir désactiver votre compte ? Il sera définitivement supprimé dans 30 jours.';

    // Alerts State (Toasts)
    alerts: { id: number; type: AlertType; message: string; }[] = [];
    private nextAlertId = 0;

    constructor(
        private fb: FormBuilder,
        private userService: UserService,
        private authService: AuthService,
        private router: Router,
        private snackBar: MatSnackBar
    ) {
        this.deleteForm = this.fb.group({
            emailConfirmation: ['', [Validators.required, Validators.email]]
        });

        // Get email directly or subscribe
        const user = this.authService.getCurrentUser();
        if (user) {
            this.currentUserEmail = user.mail;
            this.currentUserNames = { first: user.firstName, last: user.lastName };
        }
    }

    exportData(format: string = 'xlsx') {
        if (this.isExporting) return;

        this.isExporting = true;
        const dateStr = new Date().toISOString().split('T')[0];
        const fileName = `export_reloke_data_${this.currentUserNames.first}_${this.currentUserNames.last}_${dateStr}.${format}`;

        this.userService.downloadUserExport(format).subscribe({
            next: (blob) => {
                saveAs(blob, fileName);
                this.isExporting = false;
                this.snackBar.open(`✅ Export terminé : ${fileName}`, 'Fermer', {
                    duration: 5000,
                    panelClass: ['custom-snackbar-success']
                });
            },
            error: (err) => {
                console.error('Export error:', err);
                this.isExporting = false;
                this.snackBar.open('❌ Échec de l\'exportation des données', 'Fermer', {
                    duration: 5000,
                    panelClass: ['custom-snackbar-error']
                });
            }
        });
    }

    showAlert(type: AlertType, message: string) {
        const id = this.nextAlertId++;
        this.alerts.push({ id, type, message });
    }

    removeAlert(id: number) {
        this.alerts = this.alerts.filter(a => a.id !== id);
    }

    openDeleteModal() {
        this.isCheckingDeletion = true;
        this.userService.getDeletionPrecheck().subscribe({
            next: (data) => {
                this.deletionPrecheck = data;
                this.isCheckingDeletion = false;
                this.isDeleteModalOpen = true;
                this.deleteForm.reset();
            },
            error: (err) => {
                console.error('Pre-check error:', err);
                this.isCheckingDeletion = false;
                // Still allow opening the modal but with default (false) state
                this.isDeleteModalOpen = true;
                this.deleteForm.reset();
            }
        });
    }

    closeDeleteModal() {
        this.isDeleteModalOpen = false;
    }

    deleteAccount() {
        if (this.deleteForm.invalid) return;

        const inputEmail = this.deleteForm.get('emailConfirmation')?.value?.trim().toLowerCase();
        const expectedEmail = this.currentUserEmail?.trim().toLowerCase();

        if (inputEmail !== expectedEmail) {
            this.showAlert('error', `L'adresse email ne correspond pas.`);
            return;
        }

        // Close form modal and open confirmation modal to avoid z-index overlap
        this.isDeleteModalOpen = false;
        this.isConfirmationOpen = true;
    }

    onDeleteConfirmed() {
        this.isConfirmationOpen = false;
        this.isLoading = true;

        this.userService.requestDeletion().subscribe({
            next: (res) => {
                this.isLoading = false;
                this.showAlert('success', 'Votre demande de suppression a été enregistrée.');
                this.closeDeleteModal();

                // Update local user state
                const scheduledDate = new Date();
                scheduledDate.setDate(scheduledDate.getDate() + 30);
                this.authService.updateCurrentUser({ deletionScheduledAt: scheduledDate });
            },
            error: (err) => {
                console.error(err);
                this.isLoading = false;
                this.showAlert('error', 'Erreur lors de la demande de suppression.');
            }
        });
    }

    openCancelConfirmation() {
        this.isCancelConfirmationOpen = true;
    }

    closeCancelConfirmation() {
        this.isCancelConfirmationOpen = false;
    }

    onCancelConfirmed() {
        this.isCancelConfirmationOpen = false;
        this.isLoading = true;
        this.userService.cancelDeletion().subscribe({
            next: () => {
                this.isLoading = false;
                this.authService.updateCurrentUser({ deletionScheduledAt: null });

                this.showAlert('success', '✨ Ravi de voir que vous avez décidé de rester avec nous ! 🎉.\n\n Votre compte a été restauré avec succès.');
            },
            error: (err) => {
                this.isLoading = false;
                this.showAlert('error', 'Erreur lors de l\'annulation.');
            }
        });
    }

    onDeleteCancelled() {
        this.isConfirmationOpen = false;
        this.isDeleteModalOpen = true; // Re-open the form if cancelled
    }

    isDeletionScheduled(): boolean {
        const user = this.authService.getCurrentUser();
        return !!user?.deletionScheduledAt;
    }

    getRemainingTimeText(): string {
        const user = this.authService.getCurrentUser();
        if (!user?.deletionScheduledAt) return '';

        const scheduledDate = new Date(user.deletionScheduledAt);
        const now = new Date();
        const diffMs = scheduledDate.getTime() - now.getTime();

        if (diffMs <= 0) return ' imminente';

        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        const diffHours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

        let text = `${diffDays} jour${diffDays > 1 ? 's' : ''}`;
        if (diffHours > 0) {
            text += ` et ${diffHours} heure${diffHours > 1 ? 's' : ''}`;
        }

        return text;
    }
}
