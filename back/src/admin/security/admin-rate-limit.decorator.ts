import { SetMetadata } from '@nestjs/common';
import { RateLimitCategory } from './admin-rate-limit.constants';

export const ADMIN_RATE_LIMIT_KEY = 'admin_rate_limit';

export interface AdminRateLimitOptions {
  category: RateLimitCategory;
  cost?: number; // Override default cost
}

/**
 * Decorator to apply admin rate limiting to endpoints
 *
 * @example
 * ```typescript
 * @AdminRateLimit({ category: RateLimitCategory.LIGHT_READ })
 * @Get('users/:id')
 * async getUser(@Param('id') id: string) { ... }
 *
 * // With custom cost
 * @AdminRateLimit({ category: RateLimitCategory.EXPORT, cost: 5 })
 * @Get('export/users')
 * async exportUsers() { ... }
 * ```
 */
export const AdminRateLimit = (options: AdminRateLimitOptions) =>
  SetMetadata(ADMIN_RATE_LIMIT_KEY, options);
