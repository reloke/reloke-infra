import { Component, OnInit } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';

/**
 * GoogleErrorComponent
 * 
 * Handles errors during Google OAuth authentication.
 * Shows error message and provides option to retry or go back to login.
 */
@Component({
    selector: 'app-google-error',
    standalone: true,
    imports: [CommonModule],
    template: `
        <div class="min-h-screen flex items-center justify-center bg-gray-50 p-4">
            <div class="text-center max-w-md">
                <div class="mb-6">
                    <div class="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </div>
                </div>
                
                <h1 class="text-2xl font-bold text-gray-900 mb-2">Erreur de connexion</h1>
                <p class="text-gray-500 mb-6">{{ errorMessage || 'Une erreur est survenue lors de la connexion avec Google.' }}</p>
                
                <div class="space-y-3">
                    <button (click)="retryGoogle()" 
                        class="w-full flex items-center justify-center gap-3 py-3 px-4 border border-gray-300 rounded-xl bg-white hover:bg-gray-50 transition-all duration-200 shadow-sm hover:shadow">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" class="w-5 h-5">
                            <path fill="#FFC107" d="M43.611,20.083H42V20H24v8h11.303c-1.649,4.657-6.08,8-11.303,8c-6.627,0-12-5.373-12-12c0-6.627,5.373-12,12-12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C12.955,4,4,12.955,4,24c0,11.045,8.955,20,20,20c11.045,0,20-8.955,20-20C44,22.659,43.862,21.35,43.611,20.083z"/>
                            <path fill="#FF3D00" d="M6.306,14.691l6.571,4.819C14.655,15.108,18.961,12,24,12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C16.318,4,9.656,8.337,6.306,14.691z"/>
                            <path fill="#4CAF50" d="M24,44c5.166,0,9.86-1.977,13.409-5.192l-6.19-5.238C29.211,35.091,26.715,36,24,36c-5.202,0-9.619-3.317-11.283-7.946l-6.522,5.025C9.505,39.556,16.227,44,24,44z"/>
                            <path fill="#1976D2" d="M43.611,20.083H42V20H24v8h11.303c-0.792,2.237-2.231,4.166-4.087,5.571c0.001-0.001,0.002-0.001,0.003-0.002l6.19,5.238C36.971,39.205,44,34,44,24C44,22.659,43.862,21.35,43.611,20.083z"/>
                        </svg>
                        <span class="font-medium text-gray-700">Réessayer avec Google</span>
                    </button>
                    
                    <button (click)="goToLogin()" 
                        class="w-full py-3 px-4 text-gray-600 hover:text-gray-900 transition-colors font-medium">
                        Retour à la connexion
                    </button>
                </div>
            </div>
        </div>
    `,
    styles: []
})
export class GoogleErrorComponent implements OnInit {
    errorMessage: string = '';

    constructor(
        private router: Router,
        private route: ActivatedRoute
    ) { }

    ngOnInit(): void {
        // Extract error message from query params
        this.route.queryParams.subscribe(params => {
            this.errorMessage = params['message'] || 'Une erreur est survenue lors de la connexion avec Google.';
        });
    }

    retryGoogle() {
        // Redirect back to Google OAuth
        window.location.href = '/api/auth/google';
    }

    goToLogin() {
        this.router.navigate(['/auth/login']);
    }
}
