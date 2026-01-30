import {
  Injectable,
  CanActivate,
  ExecutionContext,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class CaptchaVerifiedGuard implements CanActivate {
  private readonly logger = new Logger(CaptchaVerifiedGuard.name);

  constructor(private jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const verificationToken = request.body.verificationToken;

    if (!verificationToken) {
      throw new BadRequestException('Verification token is missing');
    }

    try {
      const payload = this.jwtService.verify(verificationToken);
      if (!payload.verified) {
        throw new ForbiddenException('Invalid verification token');
      }
      return true;
    } catch (error) {
      this.logger.error('Verification token validation failed', error);
      throw new ForbiddenException('Invalid or expired verification token');
    }
  }
}
