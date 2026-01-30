/**
 * Admin Rate Limiting Constants
 * V1 - Centralized configuration for admin endpoint protection
 *
 * Categories:
 * - LIGHT_READ: Simple reads (user profile view)
 * - LIST_READ: List queries (user list, logs)
 * - HEAVY_READ: Complex aggregated queries (stats, reports)
 * - EXPORT: Data export operations
 * - ACTION: Mutation operations (ban, verify, etc.)
 * - AUTH: Authentication attempts
 * - REFRESH: Token refresh operations
 */

export enum RateLimitCategory {
  LIGHT_READ = 'LIGHT_READ',
  LIST_READ = 'LIST_READ',
  HEAVY_READ = 'HEAVY_READ',
  EXPORT = 'EXPORT',
  ACTION = 'ACTION',
  AUTH = 'AUTH',
  REFRESH = 'REFRESH',
}

export interface RateLimitConfig {
  /** Maximum requests allowed in the window */
  limit: number;
  /** Time window in seconds */
  windowSeconds: number;
  /** Cost per request (for weighted limits) */
  defaultCost: number;
  /** Percentage threshold to trigger warning (0.8 = 80%) */
  warningThreshold: number;
  /** Number of consecutive blocks before blacklist */
  blocksBeforeBlacklist: number;
  /** Block duration in seconds when limit exceeded */
  blockDurationSeconds: number;
}

export const RATE_LIMIT_CONFIGS: Record<RateLimitCategory, RateLimitConfig> = {
  [RateLimitCategory.LIGHT_READ]: {
    limit: 100,
    windowSeconds: 60,
    defaultCost: 1,
    warningThreshold: 0.8,
    blocksBeforeBlacklist: 5,
    blockDurationSeconds: 300, // 5 minutes
  },
  [RateLimitCategory.LIST_READ]: {
    limit: 30,
    windowSeconds: 60,
    defaultCost: 1,
    warningThreshold: 0.8,
    blocksBeforeBlacklist: 5,
    blockDurationSeconds: 300,
  },
  [RateLimitCategory.HEAVY_READ]: {
    limit: 60,
    windowSeconds: 60,
    defaultCost: 1,
    warningThreshold: 0.8,
    blocksBeforeBlacklist: 5,
    blockDurationSeconds: 300, // 5 minutes
  },
  [RateLimitCategory.EXPORT]: {
    limit: 5,
    windowSeconds: 300, // 5 minutes
    defaultCost: 1,
    warningThreshold: 0.6,
    blocksBeforeBlacklist: 2,
    blockDurationSeconds: 1800, // 30 minutes
  },
  [RateLimitCategory.ACTION]: {
    limit: 20,
    windowSeconds: 60,
    defaultCost: 1,
    warningThreshold: 0.7,
    blocksBeforeBlacklist: 3,
    blockDurationSeconds: 600,
  },
  [RateLimitCategory.AUTH]: {
    limit: 5,
    windowSeconds: 300, // 5 minutes
    defaultCost: 1,
    warningThreshold: 0.6,
    blocksBeforeBlacklist: 2,
    blockDurationSeconds: 3600, // 1 hour
  },
  [RateLimitCategory.REFRESH]: {
    limit: 10,
    windowSeconds: 60,
    defaultCost: 1,
    warningThreshold: 0.8,
    blocksBeforeBlacklist: 3,
    blockDurationSeconds: 600,
  },
};

// Redis key prefixes
export const REDIS_KEYS = {
  /** Rate limit counter: admin:ratelimit:{category}:{identifier} */
  RATE_LIMIT: 'admin:ratelimit',
  /** Block status: admin:blocked:{identifier} */
  BLOCKED: 'admin:blocked',
  /** Block count: admin:blockcount:{identifier} */
  BLOCK_COUNT: 'admin:blockcount',
  /** Blacklist: admin:blacklist:{identifier} */
  BLACKLIST: 'admin:blacklist',
  /** Invalidated tokens: admin:token:invalid:{tokenId} */
  TOKEN_INVALID: 'admin:token:invalid',
  /** Warning sent flag: admin:warning:{category}:{identifier} */
  WARNING_SENT: 'admin:warning',
};

// Alert email settings
export const ALERT_SETTINGS = {
  /** Admin emails to notify on security events */
  ALERT_RECIPIENTS: ['support@reloke.com', 'afdalolaofe@gmail.com'],
  /** Cooldown between warning emails (seconds) */
  WARNING_EMAIL_COOLDOWN: 3600, // 1 hour
  /** Cooldown between block emails (seconds) */
  BLOCK_EMAIL_COOLDOWN: 1800, // 30 minutes
};

// Blacklist settings
export const BLACKLIST_SETTINGS = {
  /** Default blacklist duration in seconds (0 = permanent) */
  DEFAULT_DURATION: 0,
  /** Maximum blacklist duration in seconds (30 days) */
  MAX_DURATION: 2592000,
};

/**
 * LUA script for atomic rate limit check and increment
 * Returns: [allowed: 0|1, currentCount: number, ttl: number, isWarning: 0|1]
 */
export const RATE_LIMIT_LUA_SCRIPT = `
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local cost = tonumber(ARGV[3])
local warningThreshold = tonumber(ARGV[4])

local current = redis.call('GET', key)
current = current and tonumber(current) or 0

local ttl = redis.call('TTL', key)
if ttl < 0 then
  ttl = window
end

local newCount = current + cost
local allowed = 1
local isWarning = 0

if newCount > limit then
  allowed = 0
else
  redis.call('INCRBY', key, cost)
  if ttl == window then
    redis.call('EXPIRE', key, window)
  end

  if newCount >= (limit * warningThreshold) then
    isWarning = 1
  end
end

return {allowed, newCount, ttl, isWarning}
`;

/**
 * LUA script for checking and setting block status
 * Returns: [isBlocked: 0|1, blockCount: number, shouldBlacklist: 0|1]
 */
export const BLOCK_CHECK_LUA_SCRIPT = `
local blockedKey = KEYS[1]
local blockCountKey = KEYS[2]
local blockDuration = tonumber(ARGV[1])
local blocksBeforeBlacklist = tonumber(ARGV[2])

local isBlocked = redis.call('EXISTS', blockedKey)
if isBlocked == 1 then
  local blockCount = redis.call('GET', blockCountKey)
  blockCount = blockCount and tonumber(blockCount) or 0
  return {1, blockCount, 0}
end

-- Increment block count and set block
redis.call('INCR', blockCountKey)
redis.call('EXPIRE', blockCountKey, 86400) -- 24h window for block count
redis.call('SETEX', blockedKey, blockDuration, '1')

local newBlockCount = tonumber(redis.call('GET', blockCountKey))
local shouldBlacklist = newBlockCount >= blocksBeforeBlacklist and 1 or 0

return {0, newBlockCount, shouldBlacklist}
`;
