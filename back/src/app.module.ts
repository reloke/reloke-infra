import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AdminModule } from './admin/admin.module';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { CaptchaModule } from './captcha/captcha.module';
import { CronModule } from './cron/cron.module';
import { HomeModule } from './home/home.module';
import { DiditModule } from './didit/didit.module';
import { MailModule } from './mail/mail.module';
import { MatchingModule } from './matching/matching.module';
import { PaymentModule } from './payment/payment.module';
import { PrismaModule } from './prisma/prisma.module';
import { PromoModule } from './promo/promo.module';
import { RedisModule } from './redis/redis.module';
import { SearchModule } from './search/search.module';
import { UserModule } from './user/user.module';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { RequestContextInterceptor } from './common/request-context.interceptor';
import { AuditModule } from './audit/audit.module';
import { TransactionsModule } from './transactions/transactions.module';
import { ChatModule } from './chat/chat.module';
import { ReportModule } from './report/report.module';
import { NotificationModule } from './notification/notification.module';
import { InfluencerModule } from './influencer/influencer.module';
import { HelpModule } from './help/help.module';
import { ServeStaticModule } from '@nestjs/serve-static';
import path, { join } from 'path';
import { ThrottlerModule } from '@nestjs/throttler';
import { DossierFacileModule } from './dossier-facile/dossier-facile.module';
import { GdprModule } from './gdpr/gdpr.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        process.env.NODE_ENV === 'production' ? './dist/.env' : `.env.${process.env.NODE_ENV}`, // .env.development ou .env.production
        '.env', // fallback
      ],
      // envFilePath: path.resolve('C:/Users/afdal/femnto/Dreams/Secrets/.env'),
      cache: false,
    }),
    // Rate limiting: 60 requests per minute globally
    // Admin endpoints have stricter limits applied via @Throttle decorator
    ThrottlerModule.forRoot([
      {
        ttl: 60000, // 1 minute in ms
        limit: 60, // 60 requests per minute
      },
    ]),
    ScheduleModule.forRoot(),
    AuthModule,
    UserModule,
    HomeModule,
    SearchModule,
    MatchingModule,
    PaymentModule,
    AdminModule,
    PrismaModule,
    MailModule,
    HttpModule,
    ConfigModule,
    CaptchaModule,
    RedisModule,
    CronModule,
    DiditModule, // Replaced KycModule
    PromoModule,
    AuditModule,
    TransactionsModule,
    ChatModule,
    ReportModule,
    NotificationModule,
    InfluencerModule,
    HelpModule,
    DossierFacileModule,
    GdprModule,
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), 'uploads', 'homes'),
      serveRoot: '/uploads',
    }),
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_INTERCEPTOR,
      useClass: RequestContextInterceptor,
    },
  ],
})
export class AppModule { }
