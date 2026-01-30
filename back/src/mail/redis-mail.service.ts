import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class RedisMailService {
  private readonly logger = new Logger(RedisMailService.name);
  private readonly defaultDailyLimit = 50000;

  constructor(
    private readonly redisService: RedisService,
    private readonly configService: ConfigService,
  ) {}

  getDailyKey(): string {
    const now = new Date();
    const y = now.getUTCFullYear();
    const m = String(now.getUTCMonth() + 1).padStart(2, '0');
    const d = String(now.getUTCDate()).padStart(2, '0');
    return `ses:quota:day:${y}${m}${d}`;
  }

  secondsToNextUtcMidnight(): number {
    const now = new Date();
    const next = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() + 1,
        0,
        0,
        0,
        0,
      ),
    );
    return Math.max(1, Math.floor((next.getTime() - now.getTime()) / 1000));
  }

  async reserveDailyQuotaOrNull(): Promise<{
    ok: boolean;
    retryDelayMs: number;
  }> {
    const key = this.getDailyKey();
    const limit =
      Number(this.configService.get<number>('SES_MAX_PER_DAY')) ||
      this.defaultDailyLimit;
    const ttlSeconds = this.secondsToNextUtcMidnight() + 3600;

    const script = `
      local key = KEYS[1]
      local limit = tonumber(ARGV[1])
      local ttl = tonumber(ARGV[2])
      local current = redis.call("GET", key)
      if current and tonumber(current) >= limit then
        return 0
      end
      local val = redis.call("INCR", key)
      if val == 1 then
        redis.call("EXPIRE", key, ttl)
      end
      if val > limit then
        redis.call("DECR", key)
        return 0
      end
      return 1
    `;

    const result = await this.redisService.eval(
      script,
      [key],
      [limit, ttlSeconds],
    );
    const ok = Number(result) === 1;
    if (!ok) {
      const retryDelayMs = this.secondsToNextUtcMidnight() * 1000;
      this.logger.warn(
        `Daily SES quota reached for key=${key}, retry in ${retryDelayMs}ms`,
      );
      return { ok: false, retryDelayMs };
    }
    return { ok: true, retryDelayMs: 0 };
  }

  async releaseDailyQuota(): Promise<void> {
    const key = this.getDailyKey();
    const script = `
      local key = KEYS[1]
      local current = redis.call("GET", key)
      if not current then return 0 end
      if tonumber(current) <= 0 then return 0 end
      return redis.call("DECR", key)
    `;
    await this.redisService.eval(script, [key], []);
  }
}
