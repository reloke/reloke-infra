import { Component, OnDestroy, NgZone } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { BehaviorSubject, Observable, catchError, of, tap, Subject, takeUntil } from 'rxjs';
import { Router } from '@angular/router';
import { FR } from '../../../core/i18n/fr';
import { CaptchaService } from 'src/app/services/captcha.service';
import { AuthService } from '../../../core/services/auth.service';
import { environment } from '../../../../environments/environment';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';
declare var google: any;

@Component({
  selector: 'app-login',
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss']
})
export class LoginComponent implements OnDestroy {
  loginForm: FormGroup;
  isLoading = false;
  errorMessage = '';
  showPassword = false;
  isCaptchaLoading = false;
  isCaptchaSuccess = false;
  isGoogleUserDetected = false;
  isNewUserDetected = false;
  showGoogleHint = false;
  showCguModal = false;
  hasAcceptedCgu = false;
  hasViewedCgu = false;
  pendingGoogleCredential: string | null = null; // Store for One Tap flow
  show2FA = false;
  displayEmail = '';
  otpCode = '';
  showDeletionLoginModal = false;
  loggedInUserForDeletion: any = null;

  lang = FR;
  common = FR.common;


  private destroy$ = new Subject<void>();

  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
    private router: Router,
    private captchaService: CaptchaService,
    private ngZone: NgZone
  ) {
    this.loginForm = this.fb.group({
      email: ['', [Validators.required, Validators.email]],
      password: ['', Validators.required]
    });

    // Listen to email changes to detect Google accounts
    this.loginForm.get('email')?.valueChanges.pipe(
      debounceTime(500),
      distinctUntilChanged(),
      takeUntil(this.destroy$)
    ).subscribe(email => {
      if (this.loginForm.get('email')?.valid) {
        this.checkAuthProvider(email);
      } else {
        this.isGoogleUserDetected = false;
        this.isNewUserDetected = false;
      }
    });

    this.loadGoogleOneTap();
  }

  checkAuthProvider(email: string) {
    this.authService.getAuthProvider(email).subscribe({
      next: (res) => {
        this.isGoogleUserDetected = res.exists && res.provider === 'GOOGLE';
        this.isNewUserDetected = !res.exists;
      },
      error: () => {
        this.isGoogleUserDetected = false;
        this.isNewUserDetected = false;
      }
    });
  }

  loadGoogleOneTap() {
    // Load Google One Tap SDK script dinamically if not already present
    if (document.getElementById('google-jssdk')) return;

    const script = document.createElement('script');
    script.id = 'google-jssdk';
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => {
      this.initializeGoogleOneTap();
    };
    document.head.appendChild(script);
  }

  initializeGoogleOneTap() {
    if (typeof google === 'undefined') return;

    google.accounts.id.initialize({
      client_id: environment.googleClientId,
      callback: (response: any) => this.handleGoogleOneTapResponse(response),
      auto_select: false,
      cancel_on_tap_outside: true,
      context: 'signin',
      itp_support: true,
      use_fedcm_for_prompt: false
    });

    google.accounts.id.prompt((notification: any) => {
      if (notification.isNotDisplayed()) {
        const reason = notification.getNotDisplayedReason();
        console.warn('Google One Tap not displayed:', reason);
        // Logging for debugging (cooldown, session_already_active, etc.)
        if (reason === 'suppressed_by_user') {
          console.log('One Tap: User suppressed the prompt');
        } else if (reason === 'opt_out_or_no_session') {
          console.log('One Tap: No Google session found');
        } else if (reason === 'cooldown') {
          console.log('One Tap: Cooldown active after dismissal');
        }
      } else if (notification.isSkippedMoment()) {
        console.warn('Google One Tap skipped:', notification.getSkippedReason());
      } else if (notification.isDismissedMoment()) {
        console.warn('Google One Tap dismissed:', notification.getDismissedReason());
        // Clean up g_state cookie if dismissed to allow prompt in next session (dev helpful)
        this.clearGoogleCookie();
      }
    });
  }

  private clearGoogleCookie() {
    document.cookie = "g_state=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
  }

  handleGoogleOneTapResponse(response: any) {
    this.ngZone.run(() => {
      if (response.credential) {
        this.pendingGoogleCredential = response.credential;

        // Decode JWT to get email
        const payload = JSON.parse(atob(response.credential.split('.')[1]));
        const email = payload.email;

        this.authService.getAuthProvider(email).subscribe({
          next: (res) => {
            if (res.exists) {
              // User exists, proceed directly
              this.finalizeGoogleOneTap(response.credential);
            } else {
              // New user, show CGU modal
              this.hasAcceptedCgu = false;
              this.hasViewedCgu = false;
              this.showCguModal = true;
            }
          },
          error: () => {
            // If check fails, safe to show modal
            this.showCguModal = true;
          }
        });
      }
    });
  }

  finalizeGoogleOneTap(credential: string) {
    console.log('Google One Tap: Credential received, starting auto-login...');
    this.isLoading = true;
    this.errorMessage = '';

    this.authService.googleLoginOneTap(credential)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          console.log('Google One Tap: Login success');
          this.handleLoginSuccess(res);
        },
        error: (err) => {
          this.isLoading = false;
          this.errorMessage = 'Échec de la connexion automatique avec Google.';
          console.error('Google One Tap Login Error:', err);
        }
      });
  }

  confirmCguAndGoogle() {
    this.showCguModal = false;
    if (this.pendingGoogleCredential) {
      this.finalizeGoogleOneTap(this.pendingGoogleCredential);
      this.pendingGoogleCredential = null;
    } else {
      // Manual redirect flow
      window.location.href = `${environment.apiUrl}/auth/google`;
    }
  }

  cancelCgu() {
    this.showCguModal = false;
    this.pendingGoogleCredential = null;
    this.hasAcceptedCgu = false;
  }




  async onSubmit() {
    if (this.loginForm.valid) {
      if (this.isCaptchaSuccess) {
        // Already verified, preventing double submission or logical error
        return;
      }

      this.isLoading = true; // Global loading (disables button)
      this.isCaptchaLoading = true;
      this.errorMessage = '';

      try {
        // Step 1: Execute Captcha (Google)
        const captchaToken = await this.captchaService.execute('login');

        // Step 2: Verify Captcha (Backend)
        this.captchaService.verifyCaptcha(captchaToken)
          .pipe(takeUntil(this.destroy$))
          .subscribe({
            next: (res) => {
              // Step 3: Feedback Success
              this.isCaptchaLoading = false;
              this.isCaptchaSuccess = true;

              // Step 4: Perform Action after delay
              setTimeout(() => {
                this.ngZone.run(() => {
                  this.performLogin(res.verificationToken);
                });
              }, 1000);
            },
            error: (err) => {
              this.isCaptchaLoading = false;
              this.isLoading = false;
              this.errorMessage = 'Echec de la vérification du captcha.';
              console.error('Captcha backend verification failed', err);
            }
          });

      } catch (error) {
        this.isCaptchaLoading = false;
        this.isLoading = false;
        console.error('Captcha execution error:', error);
        this.errorMessage = 'Erreur lors du chargement du captcha.';
      }
    }
  }

  performLogin(verificationToken: string) {
    const loginData = { ...this.loginForm.value, verificationToken };

    this.authService.login(loginData)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          if (response.requires2FA) {
            this.isLoading = false;
            this.show2FA = true;
            this.displayEmail = response.email;
            this.errorMessage = '';
            return;
          }
          this.handleLoginSuccess(response);
        },
        error: (err) => {
          this.isLoading = false;
          this.isCaptchaSuccess = false; // Reset if login fails
          console.log(err);

          if (err.status === 403 && (err.error?.message === 'ACCOUNT_PENDING_DELETION' || err.error?.message === 'Forbidden resource')) {
            // Check strict message or assume 403 on login might be this if not blocked user? 
            // Best to rely on message.
            if (err.error?.message === 'ACCOUNT_PENDING_DELETION') {
              this.isRestoreModalOpen = true;
              return;
            }
          }

          if (err.status === 429) {
            this.errorMessage = this.lang.auth.login.errors.tooManyRequests;
          } else if (err.error?.message === 'AUTH_PROVIDER_GOOGLE') {
            this.showGoogleHint = true;
            this.errorMessage = 'Ce compte utilise la connexion Google. Veuillez utiliser le bouton Google ci-dessous.';
          } else {
            this.errorMessage = this.lang.auth.login.errorCredentials;
          }
          console.error('Login error:', err);
        }
      });
  }

  verify2FACode() {
    if (this.otpCode.length !== 6) return;

    this.isLoading = true;
    this.errorMessage = '';

    this.authService.verifyLogin2FA(this.displayEmail, this.otpCode)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          this.handleLoginSuccess(response);
        },
        error: (err) => {
          this.isLoading = false;
          this.errorMessage = err.error?.message || 'Code invalide ou expiré.';
          console.error('2FA verification error:', err);
        }
      });
  }

  cancel2FA() {
    this.show2FA = false;
    this.otpCode = '';
    this.errorMessage = '';
    this.isLoading = false;
    this.isCaptchaSuccess = false;
  }

  handleLoginSuccess(response: any) {
    const user = response.user;
    if (response.isPendingDeletion) {
      this.showDeletionLoginModal = true;
      this.loggedInUserForDeletion = response;
      return;
    }
    this.proceedToDashboard(user);
  }

  proceedToDashboard(user: any) {
    if (user.role === 'ADMIN') {
      this.router.navigate(['/admin/dashboard']);
    } else {
      this.router.navigate(['/dashboard']);
    }
  }

  confirmRestoreAccount() {
    this.isLoading = true;
    this.authService.cancelDeletion().subscribe({
      next: () => {
        this.isLoading = false;
        this.showDeletionLoginModal = false;
        this.proceedToDashboard(this.loggedInUserForDeletion.user);
      },
      error: () => {
        this.isLoading = false;
        this.errorMessage = 'Erreur lors de la restauration du compte.';
      }
    });
  }

  continueWithRestrictedAccess() {
    this.showDeletionLoginModal = false;
    this.proceedToDashboard(this.loggedInUserForDeletion.user);
  }

  // Restore Logic
  isRestoreModalOpen = false;

  closeRestoreModal() {
    this.isRestoreModalOpen = false;
    this.loginForm.reset();
  }

  confirmRestore() {
    // Reuse credentials from form
    const loginData = this.loginForm.value;
    this.isLoading = true;
    this.isRestoreModalOpen = false;

    this.authService.restoreAccount(loginData).subscribe({
      next: (res) => {
        // Auto login success
        this.handleLoginSuccess(res);
      },
      error: (err) => {
        this.isLoading = false;
        this.errorMessage = 'Erreur lors de la réactivation. Veuillez réessayer.';
      }
    });
  }

  /**
   * Redirect to Google OAuth endpoint
   */
  signInWithGoogle() {
    const email = this.loginForm.get('email')?.value;

    // If we detected a new user via the email field
    if (this.isNewUserDetected) {
      this.hasAcceptedCgu = false;
      this.hasViewedCgu = false;
      this.showCguModal = true;
      return;
    }

    // If we know they exist or if the email is empty/not checked yet, 
    // we redirect directly to Google. 
    // Backend's callback will create the user if needed, but the user asked 
    // to "not ask directly" and "only if not exists".
    // Note: To be 100% compliant with "only if not exists", we handle 
    // the "unknown user" case by assuming they might exist until Google returns the email.
    window.location.href = `${environment.apiUrl}/auth/google`;
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();

  }
}




//   retrySeconds: number = 0; // Le temps restant en secondes
//   private retryInterval: any; // La référence du timer
// const secondsToWait = err.error.retryAfter || 300;
//   this.startCountdown(secondsToWait);
// if (this.retryInterval) clearInterval(this.retryInterval);

//   startCountdown(seconds: number) {
//     this.retrySeconds = seconds;
//     this.loginForm.disable(); // On désactive tout le formulaire

//     // Nettoie un ancien timer si existant
//     if (this.retryInterval) clearInterval(this.retryInterval);

//     this.retryInterval = setInterval(() => {
//       this.retrySeconds--;

//       if (this.retrySeconds <= 0) {
//         this.stopCountdown();
//       }
//     }, 1000);
//   }

//   stopCountdown() {
//     if (this.retryInterval) clearInterval(this.retryInterval);
//     this.retrySeconds = 0;
//     this.loginForm.enable(); // On réactive le formulaire
//     this.errorMessage = '';
//   }

//   // Petit helper pour afficher mm:ss
//   get formattedRetryTime(): string {
//     const minutes = Math.floor(this.retrySeconds / 60);
//     const seconds = this.retrySeconds % 60;
//     return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
//   }

// <button type="submit" [disabled]="loginForm.invalid || isLoading || retrySeconds > 0"
//     class="btn btn-primary w-full py-4 text-lg shadow-lg shadow-primary/20 hover:shadow-primary/40 transition-all duration-300"
//     [ngClass]="{
//         'bg-green-600 hover:bg-green-700': isCaptchaSuccess,
//         'bg-gray-400 cursor-not-allowed': retrySeconds > 0
//     }">

//     <span *ngIf="!isLoading && !isCaptchaSuccess && retrySeconds === 0">
//         {{ lang.auth.login.submitButton }}
//     </span>

//     <span *ngIf="retrySeconds > 0" class="flex items-center justify-center font-mono">
//         <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24"
//             stroke="currentColor">
//             <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
//                 d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
//         </svg>
//         Réessayer dans {{ formattedRetryTime }}
//     </span>

//     <span *ngIf="isLoading && !isCaptchaSuccess && retrySeconds === 0"
//         class="flex items-center justify-center">
//         <span *ngIf="isCaptchaLoading">Vérification du Captcha...</span>
//         <span *ngIf="!isCaptchaLoading">{{ lang.auth.login.submitButtonLoading }}</span>
//     </span>

//     <span *ngIf="isCaptchaSuccess" class="flex items-center justify-center">
//         Captcha Validé
//     </span>
// </button>
