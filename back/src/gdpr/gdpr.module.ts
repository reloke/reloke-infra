import { Module } from '@nestjs/common';
import { DataLifecycleService } from './services/data-lifecycle.service';
import { ExportService } from './services/export.service';
import { GdprController } from './gdpr.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { HomeModule } from '../home/home.module';
import { MailModule } from '../mail/mail.module';
import { AuditModule } from '../audit/audit.module';
import { MatchingModule } from '../matching/matching.module';

@Module({
  imports: [
    PrismaModule,
    HomeModule,
    MailModule,
    AuditModule,
    MatchingModule,
  ],
  controllers: [GdprController],
  providers: [DataLifecycleService, ExportService],
  exports: [DataLifecycleService],
})
export class GdprModule {}
