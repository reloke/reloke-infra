import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

/**
 * StripeService - Handles all Stripe API interactions
 *
 * Following the same pattern as S3Service:
 * - Loads credentials from ConfigService
 * - Never exposes secrets outside the service
 * - Provides mock mode when credentials are missing (development)
 */
@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);
  private readonly stripe: Stripe | null;
  private readonly isConfigured: boolean;

  // Webhook secrets for signature verification
  private readonly webhookSecretCheckout: string;
  private readonly webhookSecretRefund: string;

  // Public key for frontend (safe to expose)
  private readonly publicKey: string;

  constructor(private readonly configService: ConfigService) {
    const secretKey = this.configService.get<string>('STRIPE_SECRET_KEY') || '';
    this.publicKey = this.configService.get<string>('STRIPE_PUBLIC_KEY') || '';
    this.webhookSecretCheckout =
      this.configService.get<string>('STRIPE_WEBHOOK_SECRET_CHECKOUT') || '';
    this.webhookSecretRefund =
      this.configService.get<string>('STRIPE_WEBHOOK_SECRET_REFUND') || '';

    // Check if Stripe is properly configured
    this.isConfigured = !!(
      secretKey &&
      secretKey.startsWith('sk_') &&
      this.publicKey &&
      this.publicKey.startsWith('pk_')
    );

    if (this.isConfigured) {
      this.stripe = new Stripe(secretKey, {
        apiVersion: '2025-11-17.clover',
        typescript: true,
      });
      this.logger.log('Stripe SDK initialized successfully');
    } else {
      this.stripe = null;
      this.logger.warn(
        'Stripe is not configured - payment features will use mock implementation. ' +
        'Set STRIPE_SECRET_KEY and STRIPE_PUBLIC_KEY in your environment.',
      );
    }
  }

  /**
   * Check if Stripe is properly configured
   */
  isStripeConfigured(): boolean {
    return this.isConfigured;
  }

  /**
   * Get the Stripe client instance
   * @throws Error if Stripe is not configured
   */
  getClient(): Stripe {
    if (!this.stripe) {
      throw new Error(
        'Stripe is not configured. Please set STRIPE_SECRET_KEY and STRIPE_PUBLIC_KEY.',
      );
    }
    return this.stripe;
  }

  /**
   * Get the public key (safe to send to frontend)
   */
  getPublicKey(): string {
    return this.publicKey;
  }

  /**
   * Get the webhook secret for checkout events
   * Used for signature verification in webhook handlers
   */
  getCheckoutWebhookSecret(): string {
    return this.webhookSecretCheckout;
  }

  /**
   * Get the webhook secret for refund events
   * Used for signature verification in webhook handlers
   */
  getRefundWebhookSecret(): string {
    return this.webhookSecretRefund;
  }

  /**
   * Verify a webhook signature
   * @param payload Raw request body
   * @param signature Stripe signature header
   * @param secret Webhook secret to use
   * @returns Parsed Stripe event or null if verification fails
   */
  verifyWebhookSignature(
    payload: Buffer | string,
    signature: string,
    secret: string,
  ): Stripe.Event | null {
    if (!this.stripe) {
      this.logger.error('Cannot verify webhook: Stripe not configured');
      return null;
    }

    try {
      const event = this.stripe.webhooks.constructEvent(
        payload,
        signature,
        secret,
      );
      return event;
    } catch (err) {
      this.logger.error(
        `Webhook signature verification failed: ${err.message}`,
      );
      return null;
    }
  }

  /**
   * Create a Stripe Checkout session
   * @param params Session creation parameters
   * @returns Checkout session with URL
   */
  async createCheckoutSession(
    params: Stripe.Checkout.SessionCreateParams,
  ): Promise<Stripe.Checkout.Session> {
    if (!this.stripe) {
      // Mock mode for development
      this.logger.warn('Using mock Checkout session (Stripe not configured)');
      const mockSessionId = `cs_mock_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      return {
        id: mockSessionId,
        url: `http://localhost:4200/dashboard?payment=success&mock=true&session_id=${mockSessionId}`,
        payment_intent: `pi_mock_${Date.now()}`,
        status: 'open',
        object: 'checkout.session',
      } as unknown as Stripe.Checkout.Session;
    }

    try {
      const session = await this.stripe.checkout.sessions.create(params);
      this.logger.log(`Checkout session created: ${session.id}`);
      return session;
    } catch (err) {
      this.logger.error(`Failed to create Checkout session: ${err.message}`);
      throw err;
    }
  }

  /**
   * Retrieve a Checkout session by ID
   */
  async retrieveCheckoutSession(
    sessionId: string,
  ): Promise<Stripe.Checkout.Session | null> {
    if (!this.stripe) {
      this.logger.warn('Cannot retrieve session: Stripe not configured');
      return null;
    }

    try {
      return await this.stripe.checkout.sessions.retrieve(sessionId, {
        expand: ['payment_intent', 'payment_intent.latest_charge'],
      });
    } catch (err) {
      this.logger.error(
        `Failed to retrieve session ${sessionId}: ${err.message}`,
      );
      return null;
    }
  }

  /**
   * Create a refund for a charge
   * @param chargeId The charge ID to refund
   * @param amount Amount to refund in cents (if partial)
   * @param metadata Additional metadata
   */
  async createRefund(
    chargeId: string,
    amount?: number,
    metadata?: Record<string, string>,
  ): Promise<Stripe.Refund | null> {
    if (!this.stripe) {
      this.logger.warn('Using mock refund (Stripe not configured)');
      return {
        id: `re_mock_${Date.now()}`,
        status: 'succeeded',
        amount: amount || 0,
        charge: chargeId,
        object: 'refund',
      } as unknown as Stripe.Refund;
    }

    try {
      const refundParams: Stripe.RefundCreateParams = {
        charge: chargeId,
        metadata,
      };

      if (amount) {
        refundParams.amount = amount;
      }

      const refund = await this.stripe.refunds.create(refundParams);
      this.logger.log(`Refund created: ${refund.id} for charge ${chargeId}`);
      return refund;
    } catch (err) {
      this.logger.error(
        `Failed to create refund for charge ${chargeId}: ${err.message}`,
      );
      throw err;
    }
  }

  /**
   * Retrieve a charge by ID
   */
  async retrieveCharge(chargeId: string): Promise<Stripe.Charge | null> {
    if (!this.stripe) {
      return null;
    }

    try {
      return await this.stripe.charges.retrieve(chargeId);
    } catch (err) {
      this.logger.error(
        `Failed to retrieve charge ${chargeId}: ${err.message}`,
      );
      return null;
    }
  }
}
