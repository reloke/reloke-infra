import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AdminRateLimitService } from './admin-rate-limit.service';
import {
  ADMIN_RATE_LIMIT_KEY,
  AdminRateLimitOptions,
} from './admin-rate-limit.decorator';
import {
  RateLimitCategory,
  RATE_LIMIT_CONFIGS,
} from './admin-rate-limit.constants';

export interface RateLimitErrorResponse {
  statusCode: number;
  message: string;
  error: string;
  retryAfter?: number;
  category?: string;
  reason?: 'rate_limit' | 'blocked' | 'blacklisted';
}

@Injectable()
export class AdminRateLimitGuard implements CanActivate {
  private readonly logger = new Logger(AdminRateLimitGuard.name);

  constructor(
    private reflector: Reflector,
    private rateLimitService: AdminRateLimitService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Get rate limit options from decorator
    const options = this.reflector.get<AdminRateLimitOptions>(
      ADMIN_RATE_LIMIT_KEY,
      context.getHandler(),
    );

    // No decorator = no rate limiting for this endpoint
    if (!options) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();

    // Extract user ID and IP for identifier
    const userId = request.user?.userId || request.user?.id || 'anonymous';
    const ip = this.getClientIp(request);
    const identifier = this.rateLimitService.getIdentifier(userId, ip);

    // Check rate limit
    const result = await this.rateLimitService.checkRateLimit(
      options.category,
      identifier,
      options.cost,
    );

    // Add rate limit headers
    const config = RATE_LIMIT_CONFIGS[options.category];
    response.setHeader('X-RateLimit-Limit', config.limit);
    response.setHeader(
      'X-RateLimit-Remaining',
      Math.max(0, config.limit - result.currentCount),
    );
    response.setHeader(
      'X-RateLimit-Reset',
      Math.floor(Date.now() / 1000) + result.ttl,
    );
    response.setHeader('X-RateLimit-Category', options.category);

    if (!result.allowed) {
      this.logger.warn(
        `Rate limit exceeded for ${identifier} on ${options.category}. ` +
          `Blacklisted: ${result.isBlacklisted}, Blocked: ${result.isBlocked}`,
      );

      const errorResponse = this.buildErrorResponse(result, options.category);
      response.setHeader(
        'Retry-After',
        result.ttl || config.blockDurationSeconds,
      );

      throw new HttpException(errorResponse, errorResponse.statusCode);
    }

    // Add warning header if approaching limit
    if (result.isWarning) {
      response.setHeader('X-RateLimit-Warning', 'true');
      this.logger.log(
        `Rate limit warning for ${identifier} on ${options.category}: ${result.currentCount}/${result.limit}`,
      );
    }

    return true;
  }

  private getClientIp(request: any): string {
    // Check common headers for proxied IPs
    const forwarded = request.headers['x-forwarded-for'];
    if (forwarded) {
      const ips = forwarded.split(',').map((ip: string) => ip.trim());
      return ips[0];
    }

    const realIp = request.headers['x-real-ip'];
    if (realIp) {
      return realIp;
    }

    // Fallback to socket address
    return request.ip || request.connection?.remoteAddress || 'unknown';
  }

  private buildErrorResponse(
    result: { isBlacklisted: boolean; isBlocked: boolean; ttl: number },
    category: RateLimitCategory,
  ): RateLimitErrorResponse {
    if (result.isBlacklisted) {
      return {
        statusCode: HttpStatus.FORBIDDEN,
        message:
          "Votre accès a été révoqué. Contactez le support si vous pensez qu'il s'agit d'une erreur.",
        error: 'Forbidden',
        reason: 'blacklisted',
        category,
      };
    }

    if (result.isBlocked) {
      return {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        message:
          'Vous avez dépassé la limite de requêtes. Veuillez patienter avant de réessayer.',
        error: 'Too Many Requests',
        retryAfter: result.ttl,
        reason: 'blocked',
        category,
      };
    }

    return {
      statusCode: HttpStatus.TOO_MANY_REQUESTS,
      message: 'Limite de requêtes atteinte. Veuillez réessayer plus tard.',
      error: 'Too Many Requests',
      retryAfter: result.ttl,
      reason: 'rate_limit',
      category,
    };
  }
}
