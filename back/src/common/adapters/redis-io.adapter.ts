import { IoAdapter } from '@nestjs/platform-socket.io';
import { ServerOptions } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';
import { Logger, INestApplicationContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor: ReturnType<typeof createAdapter>;
  private readonly logger = new Logger(RedisIoAdapter.name);

  constructor(private app: INestApplicationContext) {
    super(app);
  }

  async connectToRedis(): Promise<void> {
    const configService = this.app.get(ConfigService);
    const redisHost = configService.get('REDIS_HOST', '127.0.0.1');
    const redisPort = configService.get('REDIS_PORT', 6379);
    const redisPassword = configService.get('REDIS_PASSWORD');

    const url = redisPassword
      ? `redis://:${redisPassword}@${redisHost}:${redisPort}`
      : `redis://${redisHost}:${redisPort}`;

    this.logger.log(
      `Initializing Redis adapter for Socket.io at ${redisHost}:${redisPort}...`,
    );

    const pubClient = createClient({ url });
    const subClient = pubClient.duplicate();

    pubClient.on('error', (err) =>
      this.logger.error('Redis Pub Client Error:', err),
    );
    subClient.on('error', (err) =>
      this.logger.error('Redis Sub Client Error:', err),
    );

    try {
      await Promise.all([pubClient.connect(), subClient.connect()]);
      this.adapterConstructor = createAdapter(pubClient, subClient);
      this.logger.log(
        'Successfully connected to Redis and initialized Socket.io adapter constructor',
      );
    } catch (error) {
      this.logger.error(
        'Failed to connect to Redis for Socket.io adapter:',
        error,
      );
      throw error;
    }
  }

  createIOServer(port: number, options?: ServerOptions): any {
    const server = super.createIOServer(port, options);

    if (this.adapterConstructor) {
      this.logger.log(
        `Attaching Redis adapter to server instance on port ${port}`,
      );
      server.adapter(this.adapterConstructor);
    } else {
      this.logger.warn(
        `Redis adapter constructor not ready. Using default Memory adapter for port ${port}`,
      );
    }

    return server;
  }
}
