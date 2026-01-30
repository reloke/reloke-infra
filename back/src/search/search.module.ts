import { Module } from '@nestjs/common';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';
import { SearchEmailCronService } from './search-email-cron.service';
import { PrismaModule } from '../prisma/prisma.module';
import { MailModule } from '../mail/mail.module';
import { HomeModule } from '../home/home.module';
import { SearchMaintenanceService } from './search-maintenance.service';

@Module({
  imports: [PrismaModule, MailModule, HomeModule],
  controllers: [SearchController],
  providers: [SearchService, SearchEmailCronService, SearchMaintenanceService],
  exports: [SearchService, SearchMaintenanceService],
})
export class SearchModule {}
