import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DiditService } from './didit.service';
import { DiditController } from './didit.controller';
import { DiditWebhookController } from './didit-webhook.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { UserModule } from '../user/user.module';
import { MailModule } from '../mail/mail.module';
import { HomeModule } from '../home/home.module';

@Module({
  imports: [ConfigModule, PrismaModule, UserModule, MailModule, HomeModule],
  providers: [DiditService],
  controllers: [DiditController, DiditWebhookController],
  exports: [DiditService],
})
export class DiditModule {}
