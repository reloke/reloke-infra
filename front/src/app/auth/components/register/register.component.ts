import { Component, OnDestroy } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { FR } from '../../../core/i18n/fr';
import { Subject, takeUntil, finalize } from 'rxjs';
import { CaptchaService } from 'src/app/services/captcha.service';
import { ActivatedRoute } from '@angular/router';
import { InfluencerService, InfluencerInfo } from '../../../core/services/influencer.service';
import { environment } from '../../../../environments/environment';

@Component({
  selector: 'app-register',
  templateUrl: './register.component.html',
  styleUrls: ['./register.component.scss']
})
export class RegisterComponent implements OnDestroy {
  registerForm: FormGroup;
  isLoading = false;
  errorMessage = '';
  infoMessage = '';
  currentStep = 1;
  showPassword = false;
  hasAcceptedCgu = false;
  hasViewedCgu = false;
  cguError = false;
  showCguHelpText = false;
  lang = FR;
  common = FR.common;

  registrationToken: string | null = null;
  recipientEmail: string = '';
  influencerHash: string | null = null;
  influencerInfo: InfluencerInfo | null = null;
  private destroy$ = new Subject<void>();

  // Password Strength State


  // Custom Validator & Strength Calculator


  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
    private router: Router,
    private route: ActivatedRoute,
    private captchaService: CaptchaService,
    private influencerService: InfluencerService
  ) {
    this.registerForm = this.fb.group({
      email: ['', [Validators.required, Validators.email, Validators.maxLength(150)]],
      code: ['', [Validators.required, Validators.minLength(6), Validators.maxLength(6)]],
      firstName: ['', [Validators.required, Validators.maxLength(50)]],
      lastName: ['', [Validators.required, Validators.maxLength(50)]],
      password: ['', [Validators.required]]
    });

    this.checkInfluencerSource();
  }

  private checkInfluencerSource() {
    this.influencerHash = this.route.snapshot.queryParamMap.get('f');
    if (this.influencerHash) {
      this.influencerService.getInfluencerInfo(this.influencerHash)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: (info) => {
            this.influencerInfo = info;
            console.log('Registered via influencer:', info);
          },
          error: (err) => {
            console.warn('Invalid or unknown influencer hash:', this.influencerHash);
          }
        });
    }
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }



  // Step 1: Submit Email -> Get Code
  isCaptchaLoading = false;
  isCaptchaSuccess = false;

  async submitEmail() {
    const emailControl = this.registerForm.get('email');
    if (emailControl?.valid) {
      if (this.isLoading) return; // Prevent double submission

      this.isLoading = true;
      this.isCaptchaLoading = true;
      this.errorMessage = '';

      try {
        const captchaToken = await this.captchaService.execute('register_initiate');

        this.captchaService.verifyCaptcha(captchaToken)
          .pipe(takeUntil(this.destroy$))
          .subscribe({
            next: (res) => {
              this.isCaptchaLoading = false;
              this.isCaptchaSuccess = true;
              // Call immediate, only delay the state reset for visual polish if needed, 
              // but here we move step so we can just call it.
              this.performInitiateRegister(emailControl.value, res.verificationToken);
            },
            error: (err) => {
              this.isLoading = false;
              this.isCaptchaLoading = false;
              console.error('Captcha verification failed', err);
              this.errorMessage = 'Echec de la vérification du captcha.';
            }
          });

      } catch (error) {
        console.error('Captcha error:', error);
        this.isLoading = false;
        this.isCaptchaLoading = false;
        this.errorMessage = 'Captcha validation failed.';
      }
    } else {
      emailControl?.markAsTouched();
    }
  }

  performInitiateRegister(email: string, verificationToken: string) {
    this.authService.initiateRegister(email, verificationToken)
      .pipe(
        takeUntil(this.destroy$),
        finalize(() => {
          this.isLoading = false;
          // Reset captcha state for next attempts if needed (though we move step usually)
          this.isCaptchaSuccess = false;
        })
      )
      .subscribe({
        next: () => {
          this.currentStep = 2;
          this.recipientEmail = email; // Set recipient email for display
          this.infoMessage = this.lang.auth.register.ifMailExistsOtpSent;
          this.errorMessage = ''; // Clear errors on success
        },
        error: (err: any) => {
          console.error('Error initiation', err);
          this.errorMessage = this.lang.auth.register.errors.generic;
          if (err.status === 429) {
            this.errorMessage = this.lang.auth.register.errors.tooManyRequests;
          }
        }
      });
  }

  // Step 2: Submit Code -> Get Token
  submitCode() {
    const email = this.registerForm.get('email')?.value;
    const codeControl = this.registerForm.get('code');

    if (codeControl?.valid && email) {
      this.isLoading = true;
      this.errorMessage = ''; // Clear errors on new attempt
      this.infoMessage = ''; // Clear info on new attempt

      this.authService.verifyCode(email, codeControl.value)
        .pipe(
          takeUntil(this.destroy$),
          finalize(() => this.isLoading = false)
        )
        .subscribe({
          next: (res) => {
            this.registrationToken = res.registrationToken;
            this.currentStep = 3;
          },
          error: (err) => {
            console.error('Error verification', err);
            this.errorMessage = 'Code invalide ou expiré.'; // Use i18n ideally
          }
        });
    } else {
      codeControl?.markAsTouched();
    }
  }

  async resendCode() {
    const email = this.registerForm.get('email')?.value;
    if (!email) return;

    if (this.isLoading) return;

    this.isLoading = true;
    this.isCaptchaLoading = true;
    this.errorMessage = ''; // Clear previous errors
    this.infoMessage = ''; // Clear previous info messages

    try {
      const captchaToken = await this.captchaService.execute('register_resend');

      this.captchaService.verifyCaptcha(captchaToken)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: async (res) => {
            this.isCaptchaLoading = false;
            // this.isCaptchaSuccess = true; // Removed redundant captcha success check

            // For resend, maybe less visual ceremony? But user asked for ALL.
            // Since it's a link, showing a spinner/check might be tricky inline.
            // Let's assume we proceed quickly.

            this.performResend(email, res.verificationToken);
          },
          error: (err) => {
            this.isLoading = false;
            this.isCaptchaLoading = false;
            this.errorMessage = 'Echec captcha.';
          }
        });
    } catch (error) {
      console.error('Captcha error:', error);
      this.isLoading = false;
      this.isCaptchaLoading = false;
      this.errorMessage = 'Captcha error';
    }
  }

  performResend(email: string, verificationToken: string) {
    this.authService.initiateRegister(email, verificationToken)
      .pipe(
        takeUntil(this.destroy$),
        finalize(() => {
          this.isLoading = false;
          this.isCaptchaSuccess = false;
        })
      ).subscribe({
        next: () => {
          this.infoMessage = this.lang.auth.register.ifMailExistsOtpSent;
          this.errorMessage = ''; // Clear any previous error on success
        },
        error: (err: any) => {
          this.errorMessage = this.lang.auth.register.errors.generic;
          if (err.status === 429) {
            this.errorMessage = this.lang.auth.register.errors.tooManyRequests;
          }
        }
      });
  }

  // Step 3: Finalize
  onSubmit() {
    if (this.currentStep === 1) {
      // In step 1, Enter key should probably call submitEmail
      this.submitEmail();
    } else if (this.currentStep === 2) {
      this.submitCode();
    } else if (this.currentStep === 3) {
      if (this.registerForm.valid && this.registrationToken) {
        // Relaxed logic: Checkbox must be checked, but clicking the link (hasViewedCgu) is optional/archived behavior.
        if (!this.hasAcceptedCgu) {
          this.triggerCguError();
          return;
        }
        this.finalizeRegistration();
      } else {
        this.registerForm.markAllAsTouched();
      }
    }
  }

  triggerCguError() {
    this.cguError = false;
    this.showCguHelpText = true;
    setTimeout(() => {
      this.cguError = true;
      // User request: "il faut le conserver après qu'il soit afficher"
      // So we do NOT hide it after 5 seconds anymore.
      // setTimeout(() => {
      //   this.showCguHelpText = false;
      // }, 5000);
    }, 10);
  }

  onCguLinkClicked() {
    this.hasViewedCgu = true;
    // We can clear error if they click, or just rely on the checkbox
    // this.cguError = false; 
    // this.showCguHelpText = false;
  }

  toggleCgu() {
    this.hasAcceptedCgu = !this.hasAcceptedCgu;

    // Clear error immediately if checked
    if (this.hasAcceptedCgu) {
      this.cguError = false;
      this.showCguHelpText = false;
    }
  }


  // Step 4 Logic
  activePromoCode: string | null = null;

  onPromoVerified(promoDetails: any) {
    this.activePromoCode = promoDetails.code;
  }

  onPromoRemoved() {
    this.activePromoCode = null;
  }

  // Final Submit
  finalizeRegistration() {
    if (this.registerForm.valid && this.registrationToken) {
      // Allow proceeding if all required fields are valid.
      // Promo code is optional and handled separately via its own component events.

      this.isLoading = true;
      this.errorMessage = '';

      const { firstName, lastName, password } = this.registerForm.value;

      this.authService.register({
        registrationToken: this.registrationToken,
        firstName,
        lastName,
        password,
        from: this.influencerHash || undefined, // Pass affiliation hash
        cguAccepted: this.hasAcceptedCgu,
        cguVersion: '1.0'
      })
        .pipe(
          takeUntil(this.destroy$),
          finalize(() => this.isLoading = false)
        )
        .subscribe({
          next: (response) => {
            const user = response.user;
            if (user.role === 'ADMIN') {
              this.router.navigate(['/admin/dashboard']);
            } else {
              this.router.navigate(['/dashboard'], { queryParams: { welcome: true } });
            }
          },
          error: (err) => {
            if (err.status === 409 && err.error?.message?.includes('limite')) {
              this.errorMessage = "La limite d'utilisation de ce code promo a été atteinte pendant votre inscription.";
              // Optionally reset promo state here
            } else {
              this.errorMessage = this.lang.auth.register.errors.generic;
            }
            console.error('Registration error:', err);
          }
        });
    }
  }

  prevStep() {
    if (this.currentStep > 1) {
      this.currentStep--;
      this.errorMessage = '';
      // Reset CGU acceptance if we go back from step 3
      if (this.currentStep === 2) {
        this.hasAcceptedCgu = false;
        this.hasViewedCgu = false;
      }
    }
  }

  /**
   * Redirect to Google OAuth endpoint
   */
  signInWithGoogle() {
    // Archived logic: we removed !this.hasViewedCgu requirement
    if (!this.hasAcceptedCgu) {
      this.triggerCguError();
      return;
    }
    window.location.href = `${environment.apiUrl}/auth/google`;
  }

  onGoogleCguConfirmed() {
    // Legacy - can be removed
    this.signInWithGoogle();
  }
}
