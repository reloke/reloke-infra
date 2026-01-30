import {
  Controller,
  Post,
  Body,
  Req,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request } from 'express';
import { HelpService } from './help.service';
import { CreateContactRequestDto } from './dto/create-contact-request.dto';
import { RedisService } from '../redis/redis.service';
import { HELP_CONSTANTS } from './help.constants';

@Controller('help')
export class ContactController {
  private readonly logger = new Logger(ContactController.name);

  constructor(
    private readonly helpService: HelpService,
    private readonly redisService: RedisService,
  ) {}

  /**
   * POST /help/contact
   * Public endpoint - no authentication required
   * Submit a contact request (sends emails to user and admins)
   */
  @Post('contact')
  async submitContactRequest(
    @Req() req: Request,
    @Body() dto: CreateContactRequestDto,
  ): Promise<{ message: string }> {
    // Get client IP
    const ip = this.getClientIp(req);
    const safeIp = ip.replace(/:/g, '_');

    // Rate limiting checks
    await this.checkRateLimits(safeIp, dto.email);

    // Process the contact request
    await this.helpService.processContactRequest(dto, ip);

    return {
      message:
        'Votre message a bien ete envoye. Vous recevrez une confirmation par email.',
    };
  }

  /**
   * Extract client IP from request
   */
  private getClientIp(req: Request): string {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
      const ips = Array.isArray(forwarded) ? forwarded[0] : forwarded;
      return ips.split(',')[0].trim();
    }
    return req.ip || req.socket.remoteAddress || 'unknown';
  }

  /**
   * Check rate limits for IP and email
   */
  private async checkRateLimits(safeIp: string, email: string): Promise<void> {
    const { IP, EMAIL, GLOBAL_IP } = HELP_CONSTANTS.CONTACT_RATE_LIMIT;

    // Check IP rate limit (hourly)
    const ipKey = `${IP.KEY}:${safeIp}`;
    const ipCount = await this.redisService.incr(ipKey);
    if (ipCount === 1) {
      await this.redisService.setExpire(ipKey, IP.TTL_SECONDS);
    }
    if (ipCount > IP.MAX_ATTEMPTS) {
      this.logger.warn(`[Contact] Rate limit exceeded for IP: ${safeIp}`);
      this.throwRateLimitException(
        'Trop de demandes depuis cette adresse. Veuillez reessayer plus tard.',
        IP.TTL_SECONDS,
      );
    }

    // Check global IP rate limit (daily)
    const globalIpKey = `${GLOBAL_IP.KEY}:${safeIp}`;
    const globalIpCount = await this.redisService.incr(globalIpKey);
    if (globalIpCount === 1) {
      await this.redisService.setExpire(globalIpKey, GLOBAL_IP.TTL_SECONDS);
    }
    if (globalIpCount > GLOBAL_IP.MAX_ATTEMPTS) {
      this.logger.warn(`[Contact] Daily rate limit exceeded for IP: ${safeIp}`);
      this.throwRateLimitException(
        'Limite quotidienne atteinte. Veuillez reessayer demain.',
        GLOBAL_IP.TTL_SECONDS,
      );
    }

    // Check email rate limit
    const emailKey = `${EMAIL.KEY}:${email.toLowerCase()}`;
    const emailCount = await this.redisService.incr(emailKey);
    if (emailCount === 1) {
      await this.redisService.setExpire(emailKey, EMAIL.TTL_SECONDS);
    }
    if (emailCount > EMAIL.MAX_ATTEMPTS) {
      this.logger.warn(
        `[Contact] Rate limit exceeded for email: ${this.maskEmail(email)}`,
      );
      this.throwRateLimitException(
        'Trop de demandes avec cette adresse email. Veuillez reessayer plus tard.',
        EMAIL.TTL_SECONDS,
      );
    }
  }

  /**
   * Throw rate limit exception with retry-after header
   */
  private throwRateLimitException(message: string, retryAfter: number): void {
    throw new HttpException(
      {
        message,
        retryAfter,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  /**
   * Mask email for logging
   */
  private maskEmail(email: string): string {
    const [local, domain] = email.split('@');
    if (!domain) return '***';
    const maskedLocal =
      local.length > 2
        ? local[0] + '*'.repeat(local.length - 2) + local[local.length - 1]
        : '*'.repeat(local.length);
    return `${maskedLocal}@${domain}`;
  }
}
