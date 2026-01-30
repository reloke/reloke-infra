import { Injectable } from '@angular/core';
import { AuthService, User } from './auth.service';
import { Role } from '../models/role.enum';
import { map, Observable } from 'rxjs';

@Injectable({
    providedIn: 'root'
})
export class PermissionsService {
    constructor(private authService: AuthService) { }

    /**
     * Vérifie si l'utilisateur a un certain rôle.
     * Utilise l'Observable pour une réactivité totale.
     */
    hasRole(roles: Role[]): Observable<boolean> {
        return this.authService.currentUser$.pipe(
            map(user => {
                if (!user) return false;
                return roles.includes(user.role);
            })
        );
    }

    /**
     * Vérifie si l'utilisateur possède une permission spécifique.
     * Prépare la structure pour des permissions de type string.
     */
    hasPermission(permission: string): Observable<boolean> {
        return this.authService.currentUser$.pipe(
            map(user => {
                if (!user) return false;

                // Si admin, il a toutes les permissions par défaut
                if (user.role === Role.ADMIN) return true;

                // Ici on pourrait ajouter une logique plus fine basée sur un tableau user.permissions
                // Pour l'instant, on se base sur les rôles pour simuler les permissions
                return this.checkLegacyPermission(user, permission);
            })
        );
    }

    private checkLegacyPermission(user: User, permission: string): boolean {
        // Exemple de mapping simple rôle -> permission
        const permissionsMap: Record<string, string[]> = {
            [Role.USER]: ['own:read', 'own:write'],
            [Role.ADMIN]: ['*']
        };

        const userPermissions = permissionsMap[user.role] || [];
        return userPermissions.includes('*') || userPermissions.includes(permission);
    }
}
