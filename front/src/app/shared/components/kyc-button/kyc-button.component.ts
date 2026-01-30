import { Component, Input, Output, EventEmitter, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IdentityService } from '../../../core/services/identity.service';
import { Subject, takeUntil } from 'rxjs';

@Component({
  selector: 'app-kyc-button',
  standalone: true,
  imports: [CommonModule],
  template: `
    <button 
      (click)="startVerification()"
      [disabled]="isLoading"
      class="w-full py-3 px-4 bg-primary text-white rounded-xl text-sm font-bold uppercase tracking-wider hover:bg-primary-dark transition-all shadow-lg shadow-primary/30 flex items-center justify-center gap-2 transform hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
    >
      <ng-container *ngIf="!isLoading; else loadingTpl">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
        </svg>
        {{ buttonText }}
      </ng-container>
      
      <ng-template #loadingTpl>
        <div class="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
        Chargement...
      </ng-template>
    </button>

    <div *ngIf="errorMessage" class="mt-2 p-3 bg-red-50 text-red-600 text-xs rounded-lg border border-red-100 animate-fade-in">
      {{ errorMessage }}
    </div>

    <div *ngIf="successMessage" class="mt-2 p-3 bg-green-50 text-green-600 text-xs rounded-lg border border-green-100 animate-fade-in">
      {{ successMessage }}
    </div>
  `,
  styles: [`
    @keyframes fade-in {
      from { opacity: 0; transform: translateY(-10px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .animate-fade-in {
      animation: fade-in 0.3s ease-out;
    }
  `]
})
export class KycButtonComponent implements OnDestroy {
  private destroy$ = new Subject<void>();

  @Input() buttonText: string = 'Vérifier mon identité';
  @Output() verificationStarted = new EventEmitter<void>();
  @Output() verificationFinished = new EventEmitter<{ success: boolean; error?: any }>();

  isLoading = false;
  errorMessage: string | null = null;
  successMessage: string | null = null;

  constructor(private identityService: IdentityService) { }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /**
   * Start Didit verification
   * Redirects user to the Didit verification page
   */
  startVerification() {
    this.isLoading = true;
    this.errorMessage = null;
    this.successMessage = null;
    this.verificationStarted.emit();

    this.identityService.startVerification()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          this.isLoading = false;
          console.log('KYC Session response:', response);

          if (response.verificationUrl) {
            this.successMessage = 'Redirection vers la vérification...';

            // Redirect to Didit verification page
            setTimeout(() => {
              window.location.href = response.verificationUrl;
            }, 500);

            this.verificationFinished.emit({ success: true });
          } else {
            this.errorMessage = 'Erreur lors de la création de la session de vérification.';
            this.verificationFinished.emit({ success: false, error: 'No verification URL' });
          }
        },
        error: (err) => {
          this.isLoading = false;
          this.errorMessage = err.error?.message || 'Une erreur inattendue est survenue.';
          this.verificationFinished.emit({ success: false, error: err });
        }
      });
  }
}
