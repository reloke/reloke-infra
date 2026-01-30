
import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { RedisIoAdapter } from './src/common/adapters/redis-io.adapter';

async function test() {
    console.log('Testing RedisIoAdapter...');
    const app = await NestFactory.create(AppModule);
    const adapter = new RedisIoAdapter(app);
    await adapter.connectToRedis();
    console.log('Test finished');
    await app.close();
}

test().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
});
