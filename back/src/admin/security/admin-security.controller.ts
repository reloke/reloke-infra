import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { Role } from '../../auth/enums/role.enum';
import {
  AdminRateLimitService,
  BlacklistEntry,
} from './admin-rate-limit.service';
import { AdminRateLimit } from './admin-rate-limit.decorator';
import { AdminRateLimitGuard } from './admin-rate-limit.guard';
import {
  RateLimitCategory,
  BLACKLIST_SETTINGS,
} from './admin-rate-limit.constants';

interface AddToBlacklistDto {
  identifier: string;
  reason: string;
  durationSeconds?: number;
  metadata?: Record<string, unknown>;
}

interface BlacklistResponse {
  success: boolean;
  message: string;
  entry?: BlacklistEntry;
}

@Controller('admin/security')
@UseGuards(AuthGuard('jwt'), RolesGuard, AdminRateLimitGuard)
@Roles(Role.ADMIN)
export class AdminSecurityController {
  constructor(private rateLimitService: AdminRateLimitService) {}

  /**
   * Get all blacklisted identifiers
   */
  @Get('blacklist')
  @AdminRateLimit({ category: RateLimitCategory.LIST_READ })
  async getBlacklist(): Promise<{ entries: BlacklistEntry[] }> {
    const entries = await this.rateLimitService.getAllBlacklisted();
    return { entries };
  }

  /**
   * Get specific blacklist entry
   */
  @Get('blacklist/:identifier')
  @AdminRateLimit({ category: RateLimitCategory.LIGHT_READ })
  async getBlacklistEntry(
    @Param('identifier') identifier: string,
  ): Promise<{ entry: BlacklistEntry | null }> {
    const entry = await this.rateLimitService.getBlacklistEntry(identifier);
    return { entry };
  }

  /**
   * Add identifier to blacklist
   */
  @Post('blacklist')
  @AdminRateLimit({ category: RateLimitCategory.ACTION })
  @HttpCode(HttpStatus.CREATED)
  async addToBlacklist(
    @Body() dto: AddToBlacklistDto,
    @Req() request: any,
  ): Promise<BlacklistResponse> {
    const adminEmail = request.user?.mail || request.user?.email || 'unknown';
    const duration = dto.durationSeconds ?? BLACKLIST_SETTINGS.DEFAULT_DURATION;

    // Validate duration
    if (duration > BLACKLIST_SETTINGS.MAX_DURATION) {
      return {
        success: false,
        message: `La duree maximum est de ${BLACKLIST_SETTINGS.MAX_DURATION} secondes (30 jours)`,
      };
    }

    await this.rateLimitService.addToBlacklist(
      dto.identifier,
      dto.reason,
      adminEmail,
      duration,
      dto.metadata,
    );

    const entry = await this.rateLimitService.getBlacklistEntry(dto.identifier);
    return {
      success: true,
      message: `Identifiant ${dto.identifier} ajoute a la blacklist`,
      entry: entry || undefined,
    };
  }

  /**
   * Remove identifier from blacklist
   */
  @Delete('blacklist/:identifier')
  @AdminRateLimit({ category: RateLimitCategory.ACTION })
  async removeFromBlacklist(
    @Param('identifier') identifier: string,
  ): Promise<BlacklistResponse> {
    const removed = await this.rateLimitService.removeFromBlacklist(identifier);
    return {
      success: removed,
      message: removed
        ? `Identifiant ${identifier} retire de la blacklist`
        : `Identifiant ${identifier} non trouve dans la blacklist`,
    };
  }

  /**
   * Clear block for an identifier (unblock without removing from blacklist)
   */
  @Delete('block/:identifier')
  @AdminRateLimit({ category: RateLimitCategory.ACTION })
  async clearBlock(
    @Param('identifier') identifier: string,
  ): Promise<{ success: boolean; message: string }> {
    await this.rateLimitService.clearBlock(identifier);
    return {
      success: true,
      message: `Blocage leve pour ${identifier}`,
    };
  }

  /**
   * Get rate limit stats for an identifier
   */
  @Get('ratelimit/:identifier')
  @AdminRateLimit({ category: RateLimitCategory.LIGHT_READ })
  async getRateLimitStats(@Param('identifier') identifier: string): Promise<{
    identifier: string;
    isBlocked: boolean;
    isBlacklisted: boolean;
    stats: Record<string, { count: number; limit: number; ttl: number }>;
  }> {
    const [stats, isBlocked, isBlacklisted] = await Promise.all([
      this.rateLimitService.getRateLimitStats(identifier),
      this.rateLimitService.isBlocked(identifier),
      this.rateLimitService.isBlacklisted(identifier),
    ]);

    return {
      identifier,
      isBlocked,
      isBlacklisted,
      stats,
    };
  }

  /**
   * Check if tokens are invalidated for a user
   */
  @Get('tokens/:userId/invalidated')
  @AdminRateLimit({ category: RateLimitCategory.LIGHT_READ })
  async checkTokensInvalidated(
    @Param('userId') userId: string,
  ): Promise<{ userId: string; invalidated: boolean }> {
    const invalidated = await this.rateLimitService.areTokensInvalidated(
      parseInt(userId, 10),
    );
    return { userId, invalidated };
  }

  /**
   * Manually invalidate tokens for a user
   */
  @Post('tokens/:userId/invalidate')
  @AdminRateLimit({ category: RateLimitCategory.ACTION })
  async invalidateUserTokens(
    @Param('userId') userId: string,
  ): Promise<{ success: boolean; message: string }> {
    await this.rateLimitService.invalidateUserTokens(userId);
    return {
      success: true,
      message: `Tokens invalides pour l'utilisateur ${userId}`,
    };
  }

  /**
   * Health check for rate limiting system
   */
  @Get('health')
  @AdminRateLimit({ category: RateLimitCategory.LIGHT_READ })
  async healthCheck(): Promise<{ status: string; timestamp: string }> {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }
}
