import { Injectable } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivate, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { AuthService } from '../services/auth.service';

@Injectable({
    providedIn: 'root'
})
export class AuthGuard implements CanActivate {
    private readonly redirectUrlKey = 'auth_redirect_url';

    constructor(private authService: AuthService, private router: Router) { }

    canActivate(route: ActivatedRouteSnapshot, state: RouterStateSnapshot): boolean | UrlTree {
        if (this.authService.isAuthenticated()) {
            const redirectUrl = sessionStorage.getItem(this.redirectUrlKey);
            if (redirectUrl) {
                sessionStorage.removeItem(this.redirectUrlKey);
                if (redirectUrl !== state.url) {
                    return this.router.parseUrl(redirectUrl);
                }
            }
            return true;
        }

        if (state.url && !state.url.startsWith('/auth')) {
            sessionStorage.setItem(this.redirectUrlKey, state.url);
        }
        return this.router.createUrlTree(['/auth/login']);
    }
}
