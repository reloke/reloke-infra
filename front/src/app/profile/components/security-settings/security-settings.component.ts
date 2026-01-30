import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService, User } from '../../../core/services/auth.service';
import { PasswordStrengthFieldComponent } from '../../../shared/components/password-strength-field/password-strength-field.component';
import { SharedModule } from '../../../shared/shared.module';
import { trigger, transition, style, animate } from '@angular/animations';
import { registerLocaleData } from '@angular/common';
import localeFr from '@angular/common/locales/fr';

registerLocaleData(localeFr, 'fr-FR');

@Component({
  selector: 'app-security-settings',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, SharedModule, PasswordStrengthFieldComponent],
  templateUrl: './security-settings.component.html',
  animations: [
    trigger('fadeIn', [
      transition(':enter', [
        style({ opacity: 0 }),
        animate('200ms ease-out', style({ opacity: 1 }))
      ]),
      transition(':leave', [
        animate('150ms ease-in', style({ opacity: 0 }))
      ])
    ])
  ]
})
export class SecuritySettingsComponent implements OnInit {
  passwordForm: FormGroup;
  isSubmitting = false;
  successMessage = '';
  errorMessage = '';
  showEditModal = false;
  currentUser: User | null = null;
  passwordAgeDays: string = 'inconnu';
  passwordAgeDaysColor: string = 'text-gray-500';
  passwordAgeDaysText: string = 'Nous vous recommandons de le modifier tous les 3 mois';

  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
    private router: Router
  ) {
    this.passwordForm = this.fb.group({
      currentPassword: ['', Validators.required],
      newPassword: ['', [Validators.required]],
      confirmPassword: ['', Validators.required]
    }, { validators: this.passwordMatchValidator });
  }

  ngOnInit() {
    this.authService.currentUser$.subscribe(user => {
      this.currentUser = user;
      this.calculatePasswordAge();
      this.updateFormValidators();
    });
  }

  get hasPassword(): boolean {
    return !!this.currentUser?.hasPassword;
  }

  updateFormValidators() {
    if (!this.hasPassword) {
      this.passwordForm.get('currentPassword')?.clearValidators();
    } else {
      this.passwordForm.get('currentPassword')?.setValidators([Validators.required]);
    }
    this.passwordForm.get('currentPassword')?.updateValueAndValidity();
  }

  calculatePasswordAge() {
    if (this.currentUser && this.currentUser.hasPassword && this.currentUser.lastPasswordUpdate) {
      const last = new Date(this.currentUser.lastPasswordUpdate).getTime();
      const now = new Date().getTime();
      const diff = Math.floor((now - last) / (1000 * 60 * 60 * 24));
      this.passwordAgeDays = `${diff} jour${diff > 1 ? 's' : ''}`;
      this.passwordAgeDaysColor = diff > 90 ? 'text-red-500' : 'text-orange-500';
      this.passwordAgeDaysText = diff > 90 ? 'Mot de passe trop vieux. Pensez à le modifier !' : 'Nous vous recommandons de le modifier tous les 3 mois.';
    } else {
      this.passwordAgeDays = 'inconnu';
      this.passwordAgeDaysText = !this.hasPassword
        ? 'Vous utilisez actuellement la connexion Google. Vous pouvez configurer un mot de passe pour plus de flexibilité.'
        : 'Nous vous recommandons de le modifier tous les 3 mois';
    }
  }

  passwordMatchValidator(g: FormGroup) {
    return g.get('newPassword')?.value === g.get('confirmPassword')?.value
      ? null : { mismatch: true };
  }

  openModal() {
    this.showEditModal = true;
    this.passwordForm.reset();
    this.updateFormValidators();
    this.successMessage = '';
    this.errorMessage = '';
  }

  closeModal() {
    this.showEditModal = false;
  }

  changePassword() {
    console.log('changePassword called. Form valid:', this.passwordForm.valid);
    if (this.passwordForm.invalid) {
      console.log('Form errors:', this.passwordForm.errors);
      console.log('Current password valid:', this.passwordForm.get('currentPassword')?.valid, this.passwordForm.get('currentPassword')?.errors);
      console.log('New password valid:', this.passwordForm.get('newPassword')?.valid, this.passwordForm.get('newPassword')?.errors);
      console.log('Confirm password valid:', this.passwordForm.get('confirmPassword')?.valid, this.passwordForm.get('confirmPassword')?.errors);
    }

    if (this.passwordForm.valid) {
      this.isSubmitting = true;
      this.errorMessage = '';
      this.successMessage = '';

      const { currentPassword, newPassword } = this.passwordForm.value;

      this.authService.changePassword(this.hasPassword ? currentPassword : undefined, newPassword).subscribe({
        next: () => {
          this.successMessage = this.hasPassword
            ? "Mot de passe modifié avec succès. Vous allez être déconnecté..."
            : "Mot de passe créé avec succès. Vous allez être déconnecté...";

          this.isSubmitting = false;

          // Update local state if we were to stay (but we logout)
          if (this.currentUser) {
            this.authService.updateCurrentUser({ hasPassword: true });
          }

          setTimeout(() => {
            this.authService.logout();
          }, 3000);
        },
        error: (err) => {
          this.errorMessage = err.error?.message || "Erreur lors du changement de mot de passe";
          this.isSubmitting = false;
        }
      });
    }
  }
}
