import { Module } from '@nestjs/common';
import { CaptchaService } from './captcha.service';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { CaptchaController } from './captcha.controller';

import { CaptchaVerifiedGuard } from './captcha-verified.guard';
import { CaptchaGuard } from './captcha.guard';

@Module({
  imports: [
    HttpModule,
    ConfigModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get('JWT_SECRET') || 'superSecretKey',
        signOptions: { expiresIn: '5m' },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [CaptchaController],
  providers: [CaptchaService, CaptchaGuard, CaptchaVerifiedGuard],
  exports: [CaptchaService, CaptchaGuard, CaptchaVerifiedGuard],
})
export class CaptchaModule {}
