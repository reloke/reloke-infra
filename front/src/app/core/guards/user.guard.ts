import { Injectable } from '@angular/core';
import { CanActivate, Router, UrlTree } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { Role } from '../models/role.enum';

@Injectable({
    providedIn: 'root'
})
export class UserGuard implements CanActivate {
    constructor(private authService: AuthService, private router: Router) { }

    canActivate(): boolean | UrlTree {
        const user = this.authService.getCurrentUser();

        // If user is logged in AND is ADMIN, they shouldn't be here (User Area)
        if (user && user.role === Role.ADMIN) {
            // Redirect Admin to their dashboard
            return this.router.createUrlTree(['/admin/dashboard']);
        }

        return true;
    }
}
