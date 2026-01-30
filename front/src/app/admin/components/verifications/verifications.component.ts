import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AdminService } from '../../../core/services/admin.service';
import { SharedModule } from '../../../shared/shared.module';

@Component({
  selector: 'app-admin-verifications',
  standalone: true,
  imports: [CommonModule, FormsModule, SharedModule],
  templateUrl: './verifications.component.html',
  styleUrls: ['./verifications.component.scss']
})
export class VerificationsComponent implements OnInit {
  verifications: any[] = [];
  searchTerm: string = '';
  statusFilter: string = '';

  loading = false;
  total = 0;
  page = 1;
  totalPages = 0;
  limit = 10;

  // New confirmation modals states
  showValidationConfirm = false;
  showErrorModal = false;
  modalTitle = '';
  modalMessage = '';
  userToValidate: any = null;

  // Manual Clarification Modal
  showClarifyModal = false;
  selectedUser: any = null;
  clarificationReason: string = '';
  isSendingClarification = false;
  isResetAction = false;

  statusList = [
    { value: 'PENDING', label: 'En attente' },
    { value: 'REJECTED', label: 'Rejeté' },
    { value: 'REQUIRES_INPUT', label: 'Input requis' },
    { value: 'UNVERIFIED', label: 'Non vérifié' },
    { value: 'CANCELED', label: 'Annulé' },
    { value: 'MANUAL_REVIEW', label: 'Revue Manuelle' }
  ];

  constructor(
    private adminService: AdminService,
    private snackBar: MatSnackBar
  ) { }

  ngOnInit() {
    this.loadVerifications();
  }

  loadVerifications() {
    this.loading = true;
    this.adminService.getKycVerifications(
      this.searchTerm || undefined,
      this.statusFilter || undefined,
      this.page,
      this.limit
    ).subscribe({
      next: (data) => {
        this.verifications = data.items;
        this.total = data.total;
        this.totalPages = data.totalPages;
        this.loading = false;
      },
      error: (err) => {
        console.error('Error loading verifications', err);
        this.loading = false;
      }
    });
  }

  onSearch() {
    this.page = 1;
    this.loadVerifications();
  }

  setStatusFilter(status: string) {
    this.statusFilter = status;
    this.page = 1;
    this.loadVerifications();
  }

  changePage(newPage: number) {
    if (newPage >= 1 && newPage <= this.totalPages) {
      this.page = newPage;
      this.loadVerifications();
    }
  }

  openClarifyModal(user: any) {
    this.selectedUser = user;
    this.clarificationReason = '';
    this.showClarifyModal = true;
  }

  closeClarifyModal() {
    this.showClarifyModal = false;
    this.selectedUser = null;
    this.clarificationReason = '';
  }

  confirmValidation(user: any) {
    this.userToValidate = user;
    this.modalTitle = 'Validation manuelle';
    this.modalMessage = `Êtes-vous sûr de vouloir valider MANUELLEMENT l'identité de ${user.firstName} ${user.lastName} ? Cela passera son statut en VERIFIED.`;
    this.showValidationConfirm = true;
  }

  executeValidation() {
    if (!this.userToValidate) return;

    this.showValidationConfirm = false;
    this.loading = true;

    this.adminService.verifyUser(this.userToValidate.id, true).subscribe({
      next: () => {
        this.loading = false;
        this.snackBar.open('L\'utilisateur a été validé avec succès et un email de confirmation lui a été envoyé.', 'Fermer', {
          duration: 5000,
          panelClass: ['custom-snackbar-action-success']
        });
        this.loadVerifications();
        this.userToValidate = null;
      },
      error: (err) => {
        this.loading = false;
        this.modalTitle = 'Erreur';
        this.modalMessage = 'Une erreur est survenue lors de la validation de l\'utilisateur.';
        this.showErrorModal = true;
        console.error(err);
        this.userToValidate = null;
      }
    });
  }

  // New Reset Functionality
  confirmReset(user: any) {
    this.userToValidate = user; // Reusing this variable to store the target user
    this.modalTitle = 'Réinitialiser KYC';
    this.modalMessage = `Êtes-vous sûr de vouloir RÉINITIALISER le statut KYC de ${user.firstName} ${user.lastName} ? Cela remettra ses indicateurs à zéro (tentatives, statuts, logs) et lui permettra de recommencer du début.`;
    this.showValidationConfirm = true;
    // We differentiate the action by checking a flag or context, 
    // but here to keep it simple with one modal state, we can add a property or use a different boolean.
    // Let's use a specific flag for reset to be clean.
    this.isResetAction = true;
  }

  executeReset() {
    if (!this.userToValidate) return;

    this.showValidationConfirm = false;
    this.loading = true;

    this.adminService.resetUserKyc(this.userToValidate.id).subscribe({
      next: () => {
        this.loading = false;
        this.snackBar.open('Le statut KYC a été réinitialisé avec succès.', 'Fermer', {
          duration: 5000,
          panelClass: ['custom-snackbar-action-success']
        });
        this.loadVerifications();
        this.userToValidate = null;
        this.isResetAction = false;
      },
      error: (err) => {
        this.loading = false;
        this.modalTitle = 'Erreur';
        this.modalMessage = 'Une erreur est survenue lors de la réinitialisation.';
        this.showErrorModal = true;
        console.error(err);
        this.userToValidate = null;
        this.isResetAction = false;
      }
    });
  }

  // Update executeValidation to handle the split actions if using same modal
  onConfirmModal() {
    if (this.isResetAction) {
      this.executeReset();
    } else {
      this.executeValidation();
    }
  }

  confirmClarification() {
    if (!this.selectedUser || !this.clarificationReason.trim()) return;

    this.isSendingClarification = true;
    this.adminService.sendKycClarification(this.selectedUser.id, this.clarificationReason).subscribe({
      next: () => {
        this.isSendingClarification = false;
        this.closeClarifyModal();
        this.snackBar.open('Le mail de précision a été envoyé avec succès à l\'utilisateur.', 'Fermer', {
          duration: 5000,
          panelClass: ['custom-snackbar-action-success']
        });
        this.loadVerifications(); // Refresh to show new reason in table
      },
      error: (err) => {
        this.isSendingClarification = false;
        this.modalTitle = 'Erreur';
        this.modalMessage = 'Une erreur est survenue lors de l\'envoi du mail de précision.';
        this.showErrorModal = true;
        console.error(err);
      }
    });
  }

  getStatusClass(status: string): string {
    switch (status) {
      case 'PENDING': return 'bg-yellow-100 text-yellow-700 border-yellow-200';
      case 'REJECTED': return 'bg-red-100 text-red-700 border-red-200';
      case 'REQUIRES_INPUT': return 'bg-orange-100 text-orange-700 border-orange-200';
      case 'CANCELED': return 'bg-gray-100 text-gray-500 border-gray-200';
      case 'UNVERIFIED': return 'bg-blue-50 text-blue-600 border-blue-100';
      case 'VERIFIED': return 'bg-green-100 text-green-700 border-green-200';
      case 'MANUAL_REVIEW': return 'bg-orange-500 text-white border-orange-600';
      default: return 'bg-gray-100 text-gray-600';
    }
  }
}
