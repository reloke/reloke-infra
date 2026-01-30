import { Module } from '@nestjs/common';
import { KycController } from './kyc.controller';
import { StripeModule } from '../stripe/stripe.module';
import { UserModule } from '../user/user.module';
import { ConfigModule } from '@nestjs/config';
import { HomeModule } from '../home/home.module';
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [StripeModule, UserModule, ConfigModule, HomeModule, MailModule],
  controllers: [KycController],
})
export class KycModule {}
