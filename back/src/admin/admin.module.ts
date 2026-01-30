import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminUserController } from './admin-user.controller';

import { AdminService } from './admin.service';
import { AdminUserService } from './admin-user.service';
import { AdminAuditService } from './admin-audit.service';
import { MailModule } from '../mail/mail.module';
import { HomeModule } from '../home/home.module';
import { MatchingModule } from '../matching/matching.module';
import { RedisModule } from '../redis/redis.module';

// Security
import { AdminRateLimitService } from './security/admin-rate-limit.service';
import { AdminRateLimitGuard } from './security/admin-rate-limit.guard';
import { AdminSecurityController } from './security/admin-security.controller';

import { ChatModule } from '../chat/chat.module';

@Module({
  imports: [MailModule, HomeModule, RedisModule, MatchingModule, ChatModule],
  controllers: [AdminController, AdminUserController, AdminSecurityController],
  providers: [
    AdminService,
    AdminUserService,
    AdminAuditService,
    AdminRateLimitService,
    AdminRateLimitGuard,
  ],
  exports: [
    AdminService,
    AdminUserService,
    AdminAuditService,
    AdminRateLimitService,
    AdminRateLimitGuard,
  ],
})
export class AdminModule { }
