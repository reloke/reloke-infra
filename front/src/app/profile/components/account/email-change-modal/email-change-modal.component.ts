import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { AuthService } from '../../../../core/services/auth.service';
import { SharedModule } from '../../../../shared/shared.module';

@Component({
    selector: 'app-email-change-modal',
    standalone: true,
    imports: [CommonModule, ReactiveFormsModule, SharedModule],
    templateUrl: './email-change-modal.component.html'
})
export class EmailChangeModalComponent {
    @Input() isOpen = false;
    @Input() currentEmail: string = '';
    @Output() close = new EventEmitter<void>();
    @Output() emailChanged = new EventEmitter<string>();

    step = 1;
    isLoading = false;
    error: string | null = null;

    emailForm: FormGroup;
    codeForm: FormGroup;

    constructor(private fb: FormBuilder, private authService: AuthService) {
        this.emailForm = this.fb.group({
            email: ['', [Validators.required, Validators.email]]
        });
        this.codeForm = this.fb.group({
            code: ['', [Validators.required, Validators.minLength(6)]]
        });
    }

    onClose() {
        this.close.emit();
        this.reset();
    }

    reset() {
        this.step = 1;
        this.error = null;
        this.isLoading = false;
        this.emailForm.reset();
        this.codeForm.reset();
    }

    initiateChange(event?: Event) {
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }

        console.log('initiateChange called. Form valid:', this.emailForm.valid);
        if (this.emailForm.invalid) {
            console.log('Form errors:', this.emailForm.get('email')?.errors);
            return;
        }

        const newEmail = this.emailForm.get('email')?.value;
        console.log('New email:', newEmail, 'Current email:', this.currentEmail);
        if (newEmail === this.currentEmail) {
            this.error = "La nouvelle adresse doit être différente de l'actuelle.";
            return;
        }

        this.isLoading = true;
        this.error = null;
        console.log('Sending requestEmailChange...');

        this.authService.requestChangeEmail(newEmail).subscribe({
            next: () => {
                this.isLoading = false;
                this.step = 2;
            },
            error: (err) => {
                this.isLoading = false;
                this.error = err.error?.message || 'Erreur lors de la demande.';
            }
        });
    }

    verifyCode(event?: Event) {
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }

        console.log('verifyCode called. Form valid:', this.codeForm.valid);
        if (this.codeForm.invalid) {
            console.log('Code form errors:', this.codeForm.get('code')?.errors);
            return;
        }

        this.isLoading = true;
        this.error = null;

        const newEmail = this.emailForm.get('email')?.value;
        const code = this.codeForm.get('code')?.value;
        console.log('Verifying code:', code, 'for email:', newEmail);

        this.authService.verifyChangeEmail(newEmail, code).subscribe({
            next: () => {
                this.isLoading = false;
                this.emailChanged.emit(newEmail); // Parent handles logout
                this.onClose();
            },
            error: (err) => {
                this.isLoading = false;
                this.error = err.error?.message || 'Code invalide.';
            }
        });
    }
}
