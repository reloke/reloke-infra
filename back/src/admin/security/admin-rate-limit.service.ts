import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../../redis/redis.service';
import { MailService } from '../../mail/mail.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  RateLimitCategory,
  RATE_LIMIT_CONFIGS,
  REDIS_KEYS,
  RATE_LIMIT_LUA_SCRIPT,
  BLOCK_CHECK_LUA_SCRIPT,
  ALERT_SETTINGS,
  BLACKLIST_SETTINGS,
} from './admin-rate-limit.constants';

export interface RateLimitResult {
  allowed: boolean;
  currentCount: number;
  limit: number;
  ttl: number;
  isWarning: boolean;
  isBlocked: boolean;
  isBlacklisted: boolean;
}

export interface BlacklistEntry {
  identifier: string;
  reason: string;
  addedBy: string;
  addedAt: Date;
  expiresAt: Date | null;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AdminRateLimitService {
  private readonly logger = new Logger(AdminRateLimitService.name);

  constructor(
    private redisService: RedisService,
    private mailService: MailService,
    private prismaService: PrismaService,
  ) {}

  /**
   * Get identifier for rate limiting (combines user ID and IP)
   */
  getIdentifier(userId: number | string, ip: string): string {
    return `${userId}:${ip}`;
  }

  /**
   * Check and apply rate limit for a request
   */
  async checkRateLimit(
    category: RateLimitCategory,
    identifier: string,
    cost?: number,
  ): Promise<RateLimitResult> {
    const config = RATE_LIMIT_CONFIGS[category];
    const requestCost = cost ?? config.defaultCost;

    // Check if blacklisted first (fast path)
    const isBlacklisted = await this.isBlacklisted(identifier);
    if (isBlacklisted) {
      return {
        allowed: false,
        currentCount: config.limit,
        limit: config.limit,
        ttl: 0,
        isWarning: false,
        isBlocked: false,
        isBlacklisted: true,
      };
    }

    // Check if currently blocked
    const isBlocked = await this.isBlocked(identifier);
    if (isBlocked) {
      return {
        allowed: false,
        currentCount: config.limit,
        limit: config.limit,
        ttl: await this.getBlockTtl(identifier),
        isWarning: false,
        isBlocked: true,
        isBlacklisted: false,
      };
    }

    // Execute rate limit check with LUA script (atomic)
    const rateLimitKey = `${REDIS_KEYS.RATE_LIMIT}:${category}:${identifier}`;
    const result = (await this.redisService.eval(
      RATE_LIMIT_LUA_SCRIPT,
      [rateLimitKey],
      [
        config.limit,
        config.windowSeconds,
        requestCost,
        config.warningThreshold,
      ],
    )) as [number, number, number, number];

    const [allowed, currentCount, ttl, isWarning] = result;

    // If not allowed, apply block
    if (allowed === 0) {
      await this.applyBlock(identifier, category);
      return {
        allowed: false,
        currentCount,
        limit: config.limit,
        ttl,
        isWarning: false,
        isBlocked: true,
        isBlacklisted: false,
      };
    }

    // Handle warning threshold
    if (isWarning === 1) {
      await this.handleWarning(
        identifier,
        category,
        currentCount,
        config.limit,
      );
    }

    return {
      allowed: true,
      currentCount,
      limit: config.limit,
      ttl,
      isWarning: isWarning === 1,
      isBlocked: false,
      isBlacklisted: false,
    };
  }

  /**
   * Check if an identifier is blacklisted
   */
  async isBlacklisted(identifier: string): Promise<boolean> {
    const key = `${REDIS_KEYS.BLACKLIST}:${identifier}`;
    return this.redisService.exists(key);
  }

  /**
   * Check if an identifier is currently blocked
   */
  async isBlocked(identifier: string): Promise<boolean> {
    const key = `${REDIS_KEYS.BLOCKED}:${identifier}`;
    return this.redisService.exists(key);
  }

  /**
   * Get remaining block time
   */
  async getBlockTtl(identifier: string): Promise<number> {
    const key = `${REDIS_KEYS.BLOCKED}:${identifier}`;
    const ttl = await this.redisService.ttl(key);
    return ttl > 0 ? ttl : 0;
  }

  /**
   * Apply a block and check for blacklist escalation
   */
  private async applyBlock(
    identifier: string,
    category: RateLimitCategory,
  ): Promise<void> {
    const config = RATE_LIMIT_CONFIGS[category];
    const blockedKey = `${REDIS_KEYS.BLOCKED}:${identifier}`;
    const blockCountKey = `${REDIS_KEYS.BLOCK_COUNT}:${identifier}`;

    const result = (await this.redisService.eval(
      BLOCK_CHECK_LUA_SCRIPT,
      [blockedKey, blockCountKey],
      [config.blockDurationSeconds, config.blocksBeforeBlacklist],
    )) as [number, number, number];

    const [wasAlreadyBlocked, blockCount, shouldBlacklist] = result;

    // Send block notification
    if (wasAlreadyBlocked === 0) {
      this.sendBlockAlert(identifier, category, blockCount).catch((err) =>
        this.logger.error('Failed to send block alert', err),
      );
    }

    // Escalate to blacklist if threshold reached
    if (shouldBlacklist === 1) {
      await this.addToBlacklist(
        identifier,
        'Repeated rate limit violations',
        'SYSTEM',
        BLACKLIST_SETTINGS.DEFAULT_DURATION,
      );
    }
  }

  /**
   * Handle warning threshold
   */
  private async handleWarning(
    identifier: string,
    category: RateLimitCategory,
    currentCount: number,
    limit: number,
  ): Promise<void> {
    const warningKey = `${REDIS_KEYS.WARNING_SENT}:${category}:${identifier}`;
    const alreadySent = await this.redisService.exists(warningKey);

    if (!alreadySent) {
      await this.redisService.setex(
        warningKey,
        ALERT_SETTINGS.WARNING_EMAIL_COOLDOWN,
        '1',
      );
      this.sendWarningAlert(identifier, category, currentCount, limit).catch(
        (err) => this.logger.error('Failed to send warning alert', err),
      );
    }
  }

  /**
   * Add identifier to blacklist
   */
  async addToBlacklist(
    identifier: string,
    reason: string,
    addedBy: string,
    durationSeconds: number = BLACKLIST_SETTINGS.DEFAULT_DURATION,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    const key = `${REDIS_KEYS.BLACKLIST}:${identifier}`;
    const entry: BlacklistEntry = {
      identifier,
      reason,
      addedBy,
      addedAt: new Date(),
      expiresAt:
        durationSeconds > 0
          ? new Date(Date.now() + durationSeconds * 1000)
          : null,
      metadata,
    };

    if (durationSeconds > 0) {
      await this.redisService.setex(
        key,
        durationSeconds,
        JSON.stringify(entry),
      );
    } else {
      // Permanent blacklist (use very long TTL - 10 years)
      await this.redisService.setex(key, 315360000, JSON.stringify(entry));
    }

    // Invalidate all tokens for this identifier
    await this.invalidateUserTokens(identifier);

    // Send blacklist alert
    this.sendBlacklistAlert(identifier, reason, addedBy).catch((err) =>
      this.logger.error('Failed to send blacklist alert', err),
    );

    this.logger.warn(
      `Blacklisted: ${identifier} - Reason: ${reason} - By: ${addedBy}`,
    );
  }

  /**
   * Remove identifier from blacklist
   */
  async removeFromBlacklist(identifier: string): Promise<boolean> {
    const key = `${REDIS_KEYS.BLACKLIST}:${identifier}`;
    const exists = await this.redisService.exists(key);
    if (exists) {
      await this.redisService.del(key);
      // Also clear block count
      await this.redisService.del(`${REDIS_KEYS.BLOCK_COUNT}:${identifier}`);
      this.logger.log(`Removed from blacklist: ${identifier}`);
      return true;
    }
    return false;
  }

  /**
   * Get blacklist entry details
   */
  async getBlacklistEntry(identifier: string): Promise<BlacklistEntry | null> {
    const key = `${REDIS_KEYS.BLACKLIST}:${identifier}`;
    const data = await this.redisService.get(key);
    if (data) {
      return JSON.parse(data) as BlacklistEntry;
    }
    return null;
  }

  /**
   * Get all blacklisted identifiers
   */
  async getAllBlacklisted(): Promise<BlacklistEntry[]> {
    const pattern = `${REDIS_KEYS.BLACKLIST}:*`;
    const keys = await this.redisService.keys(pattern);

    if (keys.length === 0) return [];

    const entries: BlacklistEntry[] = [];
    for (const key of keys) {
      const data = await this.redisService.get(key);
      if (data) {
        entries.push(JSON.parse(data) as BlacklistEntry);
      }
    }
    return entries;
  }

  /**
   * Invalidate tokens for a user/identifier
   */
  async invalidateUserTokens(identifier: string): Promise<void> {
    // Extract user ID if present in identifier
    const parts = identifier.split(':');
    const userId = parts[0];

    if (userId && !isNaN(Number(userId))) {
      // Mark user's tokens as invalid in Redis
      // Using a pattern that matches how tokens would be identified
      const invalidKey = `${REDIS_KEYS.TOKEN_INVALID}:user:${userId}`;
      await this.redisService.setex(
        invalidKey,
        86400 * 7,
        Date.now().toString(),
      ); // 7 days
      this.logger.log(`Invalidated tokens for user: ${userId}`);
    }
  }

  /**
   * Check if user's tokens have been invalidated
   */
  async areTokensInvalidated(userId: number): Promise<boolean> {
    const key = `${REDIS_KEYS.TOKEN_INVALID}:user:${userId}`;
    return this.redisService.exists(key);
  }

  /**
   * Clear block for an identifier
   */
  async clearBlock(identifier: string): Promise<void> {
    await this.redisService.del(`${REDIS_KEYS.BLOCKED}:${identifier}`);
  }

  /**
   * Get rate limit stats for an identifier
   */
  async getRateLimitStats(
    identifier: string,
  ): Promise<
    Record<RateLimitCategory, { count: number; limit: number; ttl: number }>
  > {
    const stats: Record<string, { count: number; limit: number; ttl: number }> =
      {};

    for (const category of Object.values(RateLimitCategory)) {
      const key = `${REDIS_KEYS.RATE_LIMIT}:${category}:${identifier}`;
      const count = await this.redisService.get(key);
      const ttl = await this.redisService.ttl(key);
      const config = RATE_LIMIT_CONFIGS[category];

      stats[category] = {
        count: count ? parseInt(count, 10) : 0,
        limit: config.limit,
        ttl: ttl > 0 ? ttl : 0,
      };
    }

    return stats as Record<
      RateLimitCategory,
      { count: number; limit: number; ttl: number }
    >;
  }

  // --- Alert Email Methods ---

  private async sendWarningAlert(
    identifier: string,
    category: RateLimitCategory,
    currentCount: number,
    limit: number,
  ): Promise<void> {
    const config = RATE_LIMIT_CONFIGS[category];
    const percentage = Math.round((currentCount / limit) * 100);

    await this.mailService.sendAdminSecurityAlert(
      ALERT_SETTINGS.ALERT_RECIPIENTS,
      'warning',
      `Rate Limit Warning: ${category}`,
      {
        identifier,
        category,
        currentCount,
        limit,
        percentage,
        threshold: config.warningThreshold * 100,
        timestamp: new Date().toISOString(),
      },
    );
  }

  private async sendBlockAlert(
    identifier: string,
    category: RateLimitCategory,
    blockCount: number,
  ): Promise<void> {
    const config = RATE_LIMIT_CONFIGS[category];

    await this.mailService.sendAdminSecurityAlert(
      ALERT_SETTINGS.ALERT_RECIPIENTS,
      'blocked',
      `User Blocked: Rate Limit Exceeded`,
      {
        identifier,
        category,
        blockCount,
        blockDuration: config.blockDurationSeconds,
        blocksBeforeBlacklist: config.blocksBeforeBlacklist,
        timestamp: new Date().toISOString(),
      },
    );
  }

  private async sendBlacklistAlert(
    identifier: string,
    reason: string,
    addedBy: string,
  ): Promise<void> {
    await this.mailService.sendAdminSecurityAlert(
      ALERT_SETTINGS.ALERT_RECIPIENTS,
      'blacklisted',
      `User Blacklisted: ${identifier}`,
      {
        identifier,
        reason,
        addedBy,
        timestamp: new Date().toISOString(),
      },
    );
  }
}
