import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MatchingController } from './matching.controller';
import { MatchingService } from './matching.service';

// Payment-related imports
import { StripeService } from './services/stripe.service';
import { MatchingPaymentsService } from './services/matching-payments.service';
import { MatchingPaymentsController } from './controllers/matching-payments.controller';
import { StripeWebhookController } from './controllers/stripe-webhook.controller';

// Match algorithm and cron
import { MatchAlgorithmService } from './services/match-algorithm.service';
import { MatchingCronService } from './services/matching-cron.service';
import { TriangleMatchingService } from './services/triangle-matching.service';

// NEW: Distributed matching queue services
import { MatchingConfigService } from './config/matching.config';
import { MatchingEnqueueService } from './services/matching-enqueue.service';
import { MatchingWorkerService } from './services/matching-worker.service';

// NEW: Notification outbox for reliable email delivery
import { NotificationOutboxService } from './services/notification-outbox.service';

// Match list controller
import { MatchListController } from './controllers/match-list.controller';
import { S3Service } from '../home/services/s3.service';

// Mail service for notifications
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [ConfigModule, MailModule],
  controllers: [
    MatchingController,
    MatchingPaymentsController,
    StripeWebhookController,
    MatchListController,
  ],
  providers: [
    // Configuration
    MatchingConfigService,

    // Core services
    MatchingService,
    StripeService,
    MatchingPaymentsService,
    MatchAlgorithmService,
    TriangleMatchingService,

    // Distributed queue services (multi-VM scalability)
    MatchingEnqueueService,
    MatchingWorkerService,
    MatchingCronService, // Now handles maintenance only

    // Notification outbox (transactional, multi-VM safe email delivery)
    NotificationOutboxService,

    // Utilities
    S3Service,
  ],
  exports: [
    MatchingConfigService,
    MatchingService,
    StripeService,
    MatchingPaymentsService,
    MatchAlgorithmService,
    MatchingCronService,
    TriangleMatchingService,
    MatchingEnqueueService,
    MatchingWorkerService,
    NotificationOutboxService,
  ],
})
export class MatchingModule {}
