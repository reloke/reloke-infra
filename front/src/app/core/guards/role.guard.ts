import { Injectable } from '@angular/core';
import { CanActivate, ActivatedRouteSnapshot, Router, UrlTree } from '@angular/router';
import { PermissionsService } from '../services/permissions.service';
import { Role } from '../models/role.enum';
import { map, Observable, take } from 'rxjs';
import { MatSnackBar } from '@angular/material/snack-bar';

@Injectable({
    providedIn: 'root'
})
export class RoleGuard implements CanActivate {
    constructor(
        private permissionsService: PermissionsService,
        private router: Router,
        private snackBar: MatSnackBar
    ) { }

    canActivate(route: ActivatedRouteSnapshot): Observable<boolean | UrlTree> {
        const roles = route.data['roles'] as Role[];

        return this.permissionsService.hasRole(roles).pipe(
            take(1),
            map(hasRole => {
                if (hasRole) {
                    return true;
                }

                // Notification visuelle élégante
                this.snackBar.open("Accès refusé : vous n'avez pas les permissions pour cette zone.", "Fermer", {
                    duration: 4000,
                    horizontalPosition: 'right',
                    verticalPosition: 'top',
                    panelClass: ['error-snackbar']
                });

                // Redirection vers le dashboard pour éviter de rester bloqué
                return this.router.createUrlTree(['/dashboard']);
            })
        );
    }
}
