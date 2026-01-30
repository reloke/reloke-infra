import { Component, OnInit, OnDestroy } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { AuthService } from '../../../core/services/auth.service';
import { Router, ActivatedRoute } from '@angular/router';
import { CaptchaService } from 'src/app/services/captcha.service';
import { Subject, takeUntil } from 'rxjs';

@Component({
  selector: 'app-verify-email',
  templateUrl: './verify-email.component.html',
  styleUrls: ['./verify-email.component.scss']
})
export class VerifyEmailComponent implements OnInit, OnDestroy {
  verifyForm: FormGroup;
  email: string = '';
  isLoading = false;
  errorMessage = '';
  private destroy$ = new Subject<void>();

  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
    private router: Router,
    private route: ActivatedRoute,
    private captchaService: CaptchaService
  ) {
    this.verifyForm = this.fb.group({
      code: ['', [Validators.required, Validators.minLength(6), Validators.maxLength(6)]]
    });
  }

  ngOnInit() {
    this.email = this.route.snapshot.queryParams['email'] || localStorage.getItem('registrationEmail');
    if (!this.email) {
      this.router.navigate(['/auth/register']);
    }
  }

  onSubmit() {
    if (this.verifyForm.valid) {
      this.isLoading = true;
      this.errorMessage = '';

      // NOTE: This component is likely deprecated in favor of the single-page Register flow.
      // We map it to the new endpoints to fix compilation, but it might not fully complete the registration 
      // since we need details (password etc) which are not present here.
      this.authService.verifyCode(this.email, this.verifyForm.get('code')?.value).subscribe({
        next: (res) => {
          // In the new flow, we get a registrationToken. 
          // We should probably redirect to register page or dashboard if this was just a verification check.
          // For now, let's redirect to register where the user can restart or maybe handle the token.
          console.log('Token:', res.registrationToken);
          this.router.navigate(['/auth/register']);
        },
        error: (err) => {
          this.isLoading = false;
          this.errorMessage = 'Code invalide ou expiré.';
          console.error('Verification error:', err);
        }
      });
    }
  }

  isCaptchaLoading = false;
  isCaptchaSuccess = false;

  async onResendCode() {
    if (this.email) {
      if (this.isCaptchaSuccess) return;

      this.isLoading = true;
      this.isCaptchaLoading = true;
      this.errorMessage = '';

      try {
        const captchaToken = await this.captchaService.execute('verify_email_resend');

        this.captchaService.verifyCaptcha(captchaToken)
          .pipe(takeUntil(this.destroy$)) // Assuming VerifyEmailComponent has destroy$ or I need to add it?
          // VerifyEmailComponent doesn't seem to have destroy$ in the view I saw earlier.
          // I should add OnDestroy implementation if missing.
          // Wait, I saw "class VerifyEmailComponent implements OnInit". It does NOT implement OnDestroy.
          // So I should add it.
          .subscribe({
            next: async (res: any) => {
              this.isCaptchaLoading = false;
              this.isCaptchaSuccess = true;

              await new Promise(resolve => setTimeout(resolve, 1000));

              this.performResend(this.email, res.verificationToken);
            },
            error: (err) => {
              this.isLoading = false;
              this.isCaptchaLoading = false;
              this.errorMessage = 'Echec captcha verification.';
            }
          });

      } catch (error) {
        console.error('Captcha error:', error);
        this.isLoading = false;
        this.isCaptchaLoading = false;
        this.errorMessage = 'Captcha error';
      }
    }
  }

  performResend(email: string, verificationToken: string) {
    this.authService.initiateRegister(email, verificationToken).subscribe({
      next: () => {
        this.isLoading = false;
        this.isCaptchaSuccess = false;
        alert('Code renvoyé avec succès!');
      },
      error: (err) => {
        this.isLoading = false;
        this.isCaptchaSuccess = false;
        this.errorMessage = 'Erreur lors du renvoi du code.';
        console.error(err);
      }
    });
  }
  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }
}

