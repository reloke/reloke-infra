import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

@Injectable()
export class StripeService {
  private stripe: Stripe;
  private readonly logger = new Logger(StripeService.name);

  constructor(private configService: ConfigService) {
    const secretKey = this.configService.get<string>(
      'STRIPE_IDENTITY_SECRET_KEY',
    );
    if (!secretKey) {
      this.logger.error('STRIPE_IDENTITY_SECRET_KEY not defined in .env');
      // Check if we should throw or just warn. For now, warn.
    }

    this.stripe = new Stripe(secretKey || '', {
      apiVersion: '2024-12-18.acacia' as any, // Bypass TS check for now or update deps
    });
  }

  /**
   * Create a Verification Session for Identity (KYC)
   */
  async createVerificationSession(userId: number, email: string) {
    try {
      const session = await this.stripe.identity.verificationSessions.create({
        type: 'document',
        metadata: {
          userId: userId.toString(),
        },
        options: {
          document: {
            require_live_capture: true,
            require_matching_selfie: true,
          },
        },
      });

      return session;
    } catch (error) {
      this.logger.error('Error creating verification session', error);
      throw error;
    }
  }

  /**
   * Get Session Details
   */
  async getVerificationSession(sessionId: string) {
    return this.stripe.identity.verificationSessions.retrieve(sessionId);
  }

  /**
   * Construct Webhook Event with Signature Verification
   */
  constructEvent(payload: string | Buffer, signature: string) {
    const secret = this.configService.get<string>(
      'STRIPE_IDENTITY_WEBHOOK_SECRET',
    );
    if (!secret) {
      throw new Error('STRIPE_IDENTITY_WEBHOOK_SECRET is not configured');
    }
    return this.stripe.webhooks.constructEvent(payload, signature, secret);
  }
}
