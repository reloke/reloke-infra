import { Component, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { Subject, takeUntil } from 'rxjs';
import { SharedModule } from 'src/app/shared/shared.module';
import { CaptchaService } from 'src/app/services/captcha.service';

@Component({
  selector: 'app-forgot-password',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterModule, SharedModule],
  templateUrl: './forgot-password.component.html',
  styleUrl: './forgot-password.component.scss'
})
export class ForgotPasswordComponent implements OnDestroy {
  forgotPasswordForm: FormGroup;
  submitted = false;
  successMessage = '';
  errorMessage = '';
  private destroy$ = new Subject<void>();

  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
    private captchaService: CaptchaService
  ) {
    this.forgotPasswordForm = this.fb.group({
      email: ['', [Validators.required, Validators.email]]
    });
  }

  get f() { return this.forgotPasswordForm.controls; }

  isLoading = false;
  isCaptchaLoading = false;
  isCaptchaSuccess = false;

  async onSubmit() {
    this.submitted = true;

    if (this.forgotPasswordForm.invalid) {
      return;
    }

    if (this.isCaptchaSuccess) return;

    const email = this.forgotPasswordForm.value.email;
    this.isLoading = true;
    this.isCaptchaLoading = true;
    this.errorMessage = '';
    this.successMessage = '';

    try {
      const captchaToken = await this.captchaService.execute('forgot_password');

      this.captchaService.verifyCaptcha(captchaToken)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: async (res) => {
            this.isCaptchaLoading = false;
            this.isCaptchaSuccess = true;

            await new Promise(resolve => setTimeout(resolve, 1000));

            this.performForgotPassword(email, res.verificationToken);
          },
          error: (err) => {
            this.isLoading = false;
            this.isCaptchaLoading = false;
            this.errorMessage = 'Echec de la vérification du captcha.';
          }
        });

    } catch (error) {
      console.error('Captcha error:', error);
      this.isLoading = false;
      this.isCaptchaLoading = false;
      this.errorMessage = 'Captcha validation failed';
    }
  }

  performForgotPassword(email: string, verificationToken: string) {
    this.authService.forgotPassword(email, verificationToken)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          this.successMessage = response.message;
          this.errorMessage = '';
          this.isLoading = false;
          // Keep success state or reset? 
          // Usually we stay on page showing message.
        },
        error: (error) => {
          this.errorMessage = error.error?.message || 'Something went wrong';
          this.successMessage = '';
          this.isLoading = false;
          this.isCaptchaSuccess = false;
        }
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
