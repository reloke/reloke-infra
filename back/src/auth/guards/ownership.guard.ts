import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Role } from '../enums/role.enum';

@Injectable()
export class OwnershipGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    const params = request.params;

    if (!user) return false;

    // Si l'utilisateur est ADMIN, il a tous les droits
    if (user.role === Role.ADMIN) return true;

    // Vérification de la propriété par rapport à un paramètre 'userId'
    if (params.userId) {
      if (Number(params.userId) !== user.userId) {
        throw new ForbiddenException(
          "Accès refusé : vous n'êtes pas le propriétaire de cette ressource.",
        );
      }
    }

    return true;
  }
}
