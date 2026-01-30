import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { CronService } from './cron.service';
import { PrismaModule } from '../prisma/prisma.module';
import { SearchModule } from '../search/search.module';
import { DiditModule } from '../didit/didit.module';
import { HomeModule } from '../home/home.module';

@Module({
  imports: [
    ScheduleModule,
    PrismaModule,
    SearchModule,
    DiditModule,
    HomeModule,
  ],
  providers: [CronService],
})
export class CronModule {}
