import { Module } from '@nestjs/common';
import { HelpService } from './help.service';
import { HelpController } from './help.controller';
import { ContactController } from './contact.controller';
import { AdminHelpService } from './admin-help.service';
import { AdminHelpController } from './admin-help.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { HomeModule } from '../home/home.module';
import { MailModule } from '../mail/mail.module';
import { AdminModule } from '../admin/admin.module';
import { RedisModule } from '../redis/redis.module';

@Module({
  imports: [PrismaModule, HomeModule, MailModule, AdminModule, RedisModule],
  controllers: [HelpController, AdminHelpController, ContactController],
  providers: [HelpService, AdminHelpService],
  exports: [HelpService, AdminHelpService],
})
export class HelpModule {}
