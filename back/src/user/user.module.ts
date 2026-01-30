import { Module } from '@nestjs/common';
import { UserController } from './user.controller';
import { ProfileController } from './profile.controller';
import { UserService } from './user.service';
import { ProfileExportService } from './services/profile-export.service';
import { MailModule } from '../mail/mail.module';
import { MatchingModule } from '../matching/matching.module';

@Module({
  imports: [MailModule, MatchingModule],
  controllers: [UserController, ProfileController],
  providers: [UserService, ProfileExportService],
  exports: [UserService, ProfileExportService],
})
export class UserModule {}
