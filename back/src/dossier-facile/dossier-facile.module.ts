import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DossierFacileService } from './dossier-facile.service';
import { DossierFacileController } from './dossier-facile.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { HttpModule } from '@nestjs/axios';
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [PrismaModule, HttpModule, MailModule, ConfigModule],
  providers: [DossierFacileService],
  controllers: [DossierFacileController],
  exports: [DossierFacileService],
})
export class DossierFacileModule {}
