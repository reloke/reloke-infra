import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { CaptchaService } from './captcha.service';
import { Logger } from '@nestjs/common';

@Injectable()
export class CaptchaGuard implements CanActivate {
  private readonly logger = new Logger(CaptchaGuard.name);
  constructor(private captchaService: CaptchaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const body = request.body;

    const token = body?.captchaToken;

    if (!token) {
      throw new BadRequestException('Captcha token is missing');
    }

    const isHuman = await this.captchaService.validateCaptchaToken(token);

    if (!isHuman) {
      this.logger.warn(
        `Captcha validation failed or Bot detected for token: ${token}`,
      );
      throw new ForbiddenException('Captcha validation failed or Bot detected');
    }

    return true;
  }
}
