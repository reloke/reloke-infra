import {
  Controller,
  Post,
  Req,
  Res,
  Headers,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request, Response } from 'express';
import Stripe from 'stripe';
import { StripeService } from '../services/stripe.service';
import { MatchingPaymentsService } from '../services/matching-payments.service';

/**
 * Stripe Webhook Controller
 *
 * Handles incoming Stripe webhook events for:
 * - checkout.session.completed (payment success)
 * - invoice.payment_failed (payment failure)
 * - charge.refund.updated (refund status changes)
 *
 * Security:
 * - Verifies Stripe signature using webhook secrets
 * - Uses raw body for signature verification
 * - Idempotent handling via stripeEventId
 */
@Controller('webhooks/stripe')
export class StripeWebhookController {
  private readonly logger = new Logger(StripeWebhookController.name);

  constructor(
    private readonly stripeService: StripeService,
    private readonly matchingPaymentsService: MatchingPaymentsService,
  ) {}

  /**
   * POST /webhooks/stripe/checkout
   *
   * Handles checkout and payment events:
   * - checkout.session.completed
   * - invoice.payment_failed
   */
  @Post('checkout')
  async handleCheckoutWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Res() res: Response,
    @Headers('stripe-signature') signature: string,
  ): Promise<void> {
    const rawBody = req.rawBody;

    if (!rawBody) {
      this.logger.error('No raw body found in request');
      res.status(HttpStatus.BAD_REQUEST).json({ error: 'No raw body' });
      return;
    }

    if (!signature) {
      this.logger.error('No Stripe signature header');
      res.status(HttpStatus.BAD_REQUEST).json({ error: 'No signature' });
      return;
    }

    // Verify webhook signature
    const webhookSecret = this.stripeService.getCheckoutWebhookSecret();
    if (!webhookSecret) {
      this.logger.warn('Checkout webhook secret not configured');
      // In development, we might want to skip signature verification
      // For production, this should return an error
    }

    const event = this.stripeService.verifyWebhookSignature(
      rawBody,
      signature,
      webhookSecret,
    );

    if (!event) {
      this.logger.error('Webhook signature verification failed');
      res.status(HttpStatus.BAD_REQUEST).json({ error: 'Invalid signature' });
      return;
    }

    this.logger.log(`Received Stripe event: ${event.type} (${event.id})`);

    try {
      switch (event.type) {
        case 'checkout.session.completed':
          await this.handleCheckoutSessionCompleted(event);
          break;

        case 'checkout.session.expired':
          await this.handleCheckoutSessionExpired(event);
          break;

        case 'invoice.payment_failed':
          await this.handleInvoicePaymentFailed(event);
          break;

        default:
          this.logger.log(`Unhandled event type: ${event.type}`);
      }

      res.status(HttpStatus.OK).json({ received: true });
    } catch (error) {
      this.logger.error(
        `Error processing webhook: ${error.message}`,
        error.stack,
      );
      // Return 200 to prevent Stripe from retrying
      // The error is logged for investigation
      res
        .status(HttpStatus.OK)
        .json({ received: true, error: 'Processing error' });
    }
  }

  /**
   * POST /webhooks/stripe/refund
   *
   * Handles refund events:
   * - charge.refund.updated
   */
  @Post('refund')
  async handleRefundWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Res() res: Response,
    @Headers('stripe-signature') signature: string,
  ): Promise<void> {
    const rawBody = req.rawBody;

    if (!rawBody) {
      this.logger.error('No raw body found in request');
      res.status(HttpStatus.BAD_REQUEST).json({ error: 'No raw body' });
      return;
    }

    if (!signature) {
      this.logger.error('No Stripe signature header');
      res.status(HttpStatus.BAD_REQUEST).json({ error: 'No signature' });
      return;
    }

    const webhookSecret = this.stripeService.getRefundWebhookSecret();
    const event = this.stripeService.verifyWebhookSignature(
      rawBody,
      signature,
      webhookSecret,
    );

    if (!event) {
      this.logger.error('Webhook signature verification failed');
      res.status(HttpStatus.BAD_REQUEST).json({ error: 'Invalid signature' });
      return;
    }

    this.logger.log(`Received Stripe event: ${event.type} (${event.id})`);

    try {
      switch (event.type) {
        case 'charge.refund.updated':
          await this.handleChargeRefundUpdated(event);
          break;

        case 'charge.refunded':
          // Could also handle this event
          this.logger.log('Charge refunded event received');
          break;

        default:
          this.logger.log(`Unhandled event type: ${event.type}`);
      }

      res.status(HttpStatus.OK).json({ received: true });
    } catch (error) {
      this.logger.error(
        `Error processing webhook: ${error.message}`,
        error.stack,
      );
      res
        .status(HttpStatus.OK)
        .json({ received: true, error: 'Processing error' });
    }
  }

  /**
   * Handle checkout.session.completed event
   */
  private async handleCheckoutSessionCompleted(
    event: Stripe.Event,
  ): Promise<void> {
    const session = event.data.object as Stripe.Checkout.Session;

    this.logger.log(`Processing checkout.session.completed: ${session.id}`);

    // Extract charge ID from payment intent
    let chargeId: string | null = null;

    if (session.payment_intent) {
      // Fetch the full session with expanded payment_intent
      const fullSession = await this.stripeService.retrieveCheckoutSession(
        session.id,
      );

      if (fullSession?.payment_intent) {
        const paymentIntent =
          typeof fullSession.payment_intent === 'string'
            ? null
            : fullSession.payment_intent;

        if (paymentIntent?.latest_charge) {
          chargeId =
            typeof paymentIntent.latest_charge === 'string'
              ? paymentIntent.latest_charge
              : paymentIntent.latest_charge.id;
        }
      }
    }

    const paymentIntentId =
      typeof session.payment_intent === 'string'
        ? session.payment_intent
        : session.payment_intent?.id || null;

    await this.matchingPaymentsService.handlePaymentSuccess(
      session.id,
      paymentIntentId || '',
      chargeId,
      event.id,
    );
  }

  /**
   * Handle checkout.session.expired event
   */
  private async handleCheckoutSessionExpired(
    event: Stripe.Event,
  ): Promise<void> {
    const session = event.data.object as Stripe.Checkout.Session;
    this.logger.log(`Checkout session expired: ${session.id}`);

    // Mark payment as failed
    await this.matchingPaymentsService.handlePaymentFailure(
      session.id,
      event.id,
      'Session expired',
    );
  }

  /**
   * Handle invoice.payment_failed event
   */
  private async handleInvoicePaymentFailed(event: Stripe.Event): Promise<void> {
    const invoice = event.data.object as Stripe.Invoice;
    this.logger.log(`Payment failed for invoice: ${invoice.id}`);

    // For one-time payments, we primarily rely on checkout.session events
    // This handler is here for completeness
    // If needed, extract session ID from metadata or invoice data
  }

  /**
   * Handle charge.refund.updated event
   */
  private async handleChargeRefundUpdated(event: Stripe.Event): Promise<void> {
    const refund = event.data.object as Stripe.Refund;
    const status = refund.status;
    const chargeId =
      typeof refund.charge === 'string' ? refund.charge : refund.charge?.id;

    if (!chargeId) {
      this.logger.error('No charge ID in refund event');
      return;
    }

    this.logger.log(
      `Refund ${refund.id} status updated to ${status} for charge ${chargeId}`,
    );

    if (status === 'succeeded') {
      await this.matchingPaymentsService.handleRefundSuccess(
        refund.id,
        chargeId,
        event.id,
        refund.amount,
      );
    } else if (status === 'failed') {
      await this.matchingPaymentsService.handleRefundFailure(
        refund.id,
        chargeId,
        event.id,
        refund.failure_reason || 'Unknown reason',
      );
    } else {
      this.logger.log(
        `Refund ${refund.id} status: ${status} (no action taken)`,
      );
    }
  }
}
