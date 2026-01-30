import { RedisService } from '../../src/redis/redis.service';

/**
 * Mock version of RedisService for unit testing.
 * Implements common Redis operations using an in-memory object or simple mocks.
 */
export const RedisServiceMock: Partial<Record<keyof RedisService, jest.Mock>> =
  {
    get: jest.fn(),
    set: jest.fn(),
    setExpire: jest.fn(),
    del: jest.fn(),
    incr: jest.fn().mockResolvedValue(1),
    hset: jest.fn(),
    hgetall: jest.fn().mockResolvedValue({}),
    hincrby: jest.fn().mockResolvedValue(1),
    // New methods added for rate limiting
    eval: jest.fn().mockResolvedValue([1, 0, 60, 0]), // [allowed, count, ttl, isWarning]
    exists: jest.fn().mockResolvedValue(false),
    setex: jest.fn(),
    mget: jest.fn().mockResolvedValue([]),
    keys: jest.fn().mockResolvedValue([]),
    ttl: jest.fn().mockResolvedValue(-1),
  };
