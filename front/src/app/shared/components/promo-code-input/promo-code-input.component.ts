import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../../environments/environment';
import { catchError } from 'rxjs/operators';
import { of } from 'rxjs';

@Component({
    selector: 'app-promo-code-input',
    standalone: true,
    imports: [CommonModule, ReactiveFormsModule],
    template: `
    <div class="space-y-4">
      <div class="relative">
        <label class="block text-sm font-medium text-gray-700 mb-1">Code Promo (Optionnel)</label>
        <div class="flex gap-2">
          <input 
            type="text" 
            [formControl]="promoControl" 
            class="block w-full rounded-lg border-gray-300 shadow-sm focus:border-primary focus:ring-primary sm:text-sm uppercase placeholder-gray-400 py-3 px-4 border" 
            placeholder="EX: SUMMER2025"
            [class.border-green-500]="status === 'VALID'"
            [class.border-red-500]="status === 'INVALID' || status === 'EXPIRED'"
            [readonly]="status === 'VALID'"
          >
          <button 
            *ngIf="status !== 'VALID'"
            (click)="verifyCode()"
            [disabled]="promoControl.invalid || isLoading || !promoControl.value"
            class="px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-black transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
          >
            {{ isLoading ? '...' : 'Vérifier' }}
          </button>
          
          <button 
             *ngIf="status === 'VALID'"
             (click)="reset()"
             class="px-4 py-2 bg-gray-100 text-gray-600 rounded-lg text-sm font-medium hover:bg-gray-200 transition-colors"
          >
             Retirer
          </button>
        </div>

        <!-- Feedback Messages -->
        <div *ngIf="status === 'VALID'" class="mt-2 flex items-center text-sm text-green-600 animate-fade-in">
           <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-1" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
           </svg>
           Code validé ! -{{ details?.discountPercentage }}% (Code: {{ details?.code }})
        </div>

        <div *ngIf="status === 'INVALID'" class="mt-2 text-sm text-red-600 animate-fade-in">
           Ce code est invalide ou n'existe pas.
        </div>

        <div *ngIf="status === 'EXPIRED'" class="mt-2 text-sm text-red-600 animate-fade-in">
           Ce code a expiré ou la limite d'utilisation est atteinte.
        </div>
      </div>
    </div>
  `,
    styles: [`
    :host { display: block; }
    .animate-fade-in { animation: fadeIn 0.3s ease-in-out; }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(-5px); } to { opacity: 1; transform: translateY(0); } }
  `]
})
export class PromoCodeInputComponent {
    @Output() promoVerified = new EventEmitter<any>();
    @Output() promoRemoved = new EventEmitter<void>();

    promoControl = new FormControl('', [Validators.minLength(3)]);
    status: 'IDLE' | 'VALID' | 'INVALID' | 'EXPIRED' = 'IDLE';
    isLoading = false;
    details: any = null;

    constructor(private http: HttpClient) { }

    verifyCode() {
        if (this.promoControl.invalid || !this.promoControl.value) return;

        this.isLoading = true;
        const code = this.promoControl.value.trim().toUpperCase();

        this.http.get(`${environment.apiUrl}/promos/check/${code}`)
            .pipe(
                catchError(err => {
                    this.isLoading = false;
                    if (err.status === 409 || err.status === 400) { // Conflict (Limit reached) or Bad Request (Expired)
                        this.status = 'EXPIRED';
                    } else {
                        this.status = 'INVALID';
                    }
                    return of(null);
                })
            )
            .subscribe((res: any) => {
                this.isLoading = false;
                if (res) {
                    this.status = 'VALID';
                    this.details = res;
                    this.promoControl.disable(); // Lock input
                    this.promoVerified.emit(res);
                }
            });
    }

    reset() {
        this.status = 'IDLE';
        this.details = null;
        this.promoControl.enable();
        this.promoControl.setValue('');
        this.promoRemoved.emit();
    }
}
