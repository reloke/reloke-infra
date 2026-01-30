import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HomeController } from './home.controller';
import { HomeService } from './home.service';
import { GooglePlacesService } from './services/google-places.service';
import { S3Service } from './services/s3.service';
import { HomeImagesService } from './services/home-images.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule, ConfigModule],
  controllers: [HomeController],
  providers: [HomeService, GooglePlacesService, S3Service, HomeImagesService],
  exports: [HomeService, S3Service],
})
export class HomeModule {}
