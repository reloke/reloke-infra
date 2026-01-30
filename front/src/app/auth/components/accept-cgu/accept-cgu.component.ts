import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { environment } from 'src/environments/environment';
import { AuthService } from 'src/app/core/services/auth.service';
import { LoadingComponent } from 'src/app/shared/components/loading/loading.component';

@Component({
    selector: 'app-accept-cgu',
    standalone: true,
    imports: [CommonModule, ReactiveFormsModule, RouterLink, LoadingComponent],
    templateUrl: './accept-cgu.component.html'
})
export class AcceptCguComponent implements OnInit {
    form: FormGroup;
    isLoading = false;
    errorMessage = '';
    firstName = '';
    tempToken = '';

    constructor(
        private fb: FormBuilder,
        private route: ActivatedRoute,
        private router: Router,
        private http: HttpClient,
        private authService: AuthService
    ) {
        this.form = this.fb.group({
            acceptCgu: [false, Validators.requiredTrue]
        });
    }

    ngOnInit() {
        this.route.queryParams.subscribe(params => {
            this.tempToken = params['token'];
            this.firstName = params['name'] || 'Utilisateur';

            if (!this.tempToken) {
                this.errorMessage = 'Jeton d\'inscription manquant ou invalide.';
                this.router.navigate(['/auth/login']);
            }
        });
    }

    onSubmit() {
        if (this.form.invalid) {
            this.form.markAllAsTouched();
            return;
        }

        this.isLoading = true;
        this.errorMessage = '';

        const url = `${environment.apiUrl}/auth/google/complete`;

        this.http.post<any>(url, { tempToken: this.tempToken }, { headers: { 'X-Skip-Interceptor': 'true' } }).subscribe({
            next: (response) => {
                // Use existing auth service method to handle session storage
                this.authService.handleLoginSuccess(response);
                this.router.navigate(['/dashboard'], { queryParams: { welcome: 'google' } });
                this.isLoading = false;
            },
            error: (err) => {
                console.error('CGU Completion Error', err);
                this.errorMessage = err.error?.message || 'Une erreur est survenue. Veuillez réessayer.';
                this.isLoading = false;
            }
        });
    }
}
