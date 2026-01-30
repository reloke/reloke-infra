import { Injectable } from '@angular/core';
import { CanActivate, Router, UrlTree } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { Role } from '../models/role.enum';

@Injectable({
    providedIn: 'root'
})
export class AdminGuard implements CanActivate {
    constructor(private authService: AuthService, private router: Router) { }

    canActivate(): boolean | UrlTree {
        const user = this.authService.getCurrentUser();

        if (user && user.role === Role.ADMIN) {
            return true;
        }

        // Redirect to 403 Forbidden page or Home
        return this.router.createUrlTree(['/error'], { queryParams: { error: 403 } });
    }
}
