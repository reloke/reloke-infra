import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { AuthService, User } from '../../../core/services/auth.service';
import { LoadingComponent } from '../../../shared/components/loading/loading.component';

/**
 * GoogleSuccessComponent
 * 
 * Handles the redirect after successful Google OAuth authentication.
 * The backend has already set the authentication cookies,
 * so we just need to fetch the user profile and redirect.
 */
@Component({
    selector: 'app-google-success',
    standalone: true,
    imports: [CommonModule, LoadingComponent],
    template: `
        <div class="min-h-screen flex items-center justify-center bg-gray-50">
            <div class="text-center">
                <div class="mb-6">
                    <app-loading size="lg"></app-loading>
                </div>
                <h1 class="text-2xl font-bold text-gray-900 mb-2">Connexion en cours...</h1>
                <p class="text-gray-500">Vous allez être redirigé automatiquement.</p>
                
                <div *ngIf="error" class="mt-6 p-4 bg-red-50 border border-red-200 rounded-lg max-w-md mx-auto">
                    <p class="text-red-600">{{ error }}</p>
                    <button (click)="goToLogin()" 
                        class="mt-4 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-dark transition-colors">
                        Retour à la connexion
                    </button>
                </div>
            </div>
        </div>
    `,
    styles: []
})
export class GoogleSuccessComponent implements OnInit {
    error: string | null = null;

    constructor(
        private authService: AuthService,
        private router: Router
    ) { }

    ngOnInit(): void {
        this.handleGoogleCallback();
    }

    handleGoogleCallback(): void {
        // Fetch current user (cookie is already set by backend)
        this.authService.getMe().subscribe({
            next: (user: User | null) => {
                if (user) {
                    // Redirect based on role
                    if (user.role === 'ADMIN') {
                        this.router.navigate(['/admin/dashboard']);
                    } else {
                        this.router.navigate(['/dashboard']);
                    }
                } else {
                    this.error = 'Impossible de récupérer les informations utilisateur.';
                }
            },
            error: (err: Error) => {
                console.error('Error fetching user after Google login:', err);
                this.error = 'Une erreur est survenue lors de la connexion.';
            }
        });
    }

    goToLogin(): void {
        this.router.navigate(['/auth/login']);
    }
}
