import { Module } from '@nestjs/common';
import { MailController } from './mail.controller';
import { MailService } from './mail.service';
import { ConfigModule } from '@nestjs/config';
import { AwsConfigService } from '../aws/aws-config.service';
import { MailQueueModule } from './mail-queue.module';
import { RedisMailService } from './redis-mail.service';
import { MailProcessor } from './mail.processor';
import { RedisModule } from '../redis/redis.module';

@Module({
  imports: [ConfigModule, MailQueueModule, RedisModule],
  controllers: [MailController],
  providers: [MailService, AwsConfigService, RedisMailService, MailProcessor],
  exports: [MailService],
})
export class MailModule {}
