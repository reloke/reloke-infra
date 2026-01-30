import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { StripeService } from './stripe.service';
import { MailService } from '../../mail/mail.service';
import {
  MATCH_PACKS,
  MatchPackType,
  computeClientAmounts,
  eurosToCents,
  calculatePricePerMatch,
  calculateRefundAmount,
  getPackByType,
  PaymentStatus,
  TransactionType,
  TransactionStatus,
} from '../config/match-packs.config';
import {
  MatchingSummaryDto,
  PaymentSummaryDto,
  RefundResponseDto,
  PackInfoDto,
} from '../dto/matching-payments.dto';
import {
  MatchingConfigService,
  MatchingErrorCode,
} from '../config/matching.config';

@Injectable()
export class MatchingPaymentsService {
  private readonly logger = new Logger(MatchingPaymentsService.name);
  private readonly frontendUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripeService: StripeService,
    private readonly configService: ConfigService,
    private readonly matchingConfig: MatchingConfigService,
    private readonly mailService: MailService,
  ) {
    this.frontendUrl =
      this.configService.get<string>('FRONTEND_URL') || 'http://localhost:4200';
  }

  /**
   * Get all available packs with computed pricing
   */
  getAvailablePacks(): PackInfoDto[] {
    return MATCH_PACKS.map((pack) => {
      const amounts = computeClientAmounts(pack.baseAmount);
      return {
        planType: pack.planType,
        label: pack.label,
        labelFr: pack.labelFr,
        matches: pack.matches,
        baseAmount: amounts.amountBase,
        fees: amounts.amountFees,
        totalAmount: amounts.amountTotal,
        pricePerMatch: calculatePricePerMatch(pack.baseAmount, pack.matches),
        description: pack.description,
        isRecommended: pack.isRecommended || false,
      };
    });
  }

  /**
   * Create a Stripe Checkout session for purchasing a match pack
   *
   * IMPORTANT: This method now checks for refund cooldown.
   * After a refund, users must wait REFUND_REBUY_COOLDOWN_DAYS (default 14)
   * before purchasing a new pack. This prevents abuse.
   */
  async createCheckoutSession(
    userId: number,
    planType: MatchPackType,
  ): Promise<{ url: string; sessionId: string }> {
    // Block banned users
    const userStatus = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isBanned: true },
    });
    if (userStatus?.isBanned) {
      throw new ForbiddenException('Compte banni : achat de packs impossible.');
    }

    // 0) CHECK ACCOUNT VALIDATION (BACKEND GUARD)
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isKycVerified: true },
    });

    if (!user) {
      throw new BadRequestException('Utilisateur introuvable');
    }

    if (!user.isKycVerified) {
      // Choisis 403 si tu veux que ce soit “logiquement” une interdiction.
      // Si tu préfères rester cohérent avec tes autres erreurs métier (cooldown -> 400),
      // remplace ForbiddenException par BadRequestException.
      throw new ForbiddenException({
        code: 'ACCOUNT_NOT_VALIDATED',
        message:
          'Veuillez valider votre compte avant de continuer. La vérification d’identité protège tous les utilisateurs et améliore la qualité du service.',
      });
    }

    // 1. Get pack configuration
    const pack = getPackByType(planType);
    if (!pack) {
      throw new BadRequestException(`Pack type invalide: ${planType}`);
    }

    // 2. Find or create Intent for this user
    let intent = await this.prisma.intent.findFirst({
      where: { userId },
      select: {
        id: true,
        refundCooldownUntil: true,
      },
    });

    // 3. CHECK REFUND COOLDOWN
    // If the user recently got a refund, they must wait before buying again.
    // This prevents abuse: buy -> test -> refund -> repeat
    if (
      intent?.refundCooldownUntil &&
      intent.refundCooldownUntil > new Date()
    ) {
      const cooldownEnd = intent.refundCooldownUntil;
      const formattedDate = cooldownEnd.toLocaleDateString('fr-FR', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });

      this.logger.warn(
        `User ${userId} blocked from purchase: refund cooldown until ${cooldownEnd.toISOString()}`,
      );

      throw new BadRequestException({
        code: MatchingErrorCode.REFUND_COOLDOWN_ACTIVE,
        message: `Vous pourrez acheter un nouveau pack à partir du ${formattedDate}.`,
        cooldownUntil: cooldownEnd.toISOString(),
      });
    }

    // 4. Compute amounts
    const amounts = computeClientAmounts(pack.baseAmount);
    const pricePerMatch = calculatePricePerMatch(pack.baseAmount, pack.matches);

    // 5. Create Intent if it doesn't exist
    if (!intent) {
      intent = await this.prisma.intent.create({
        data: {
          userId,
          numberOfMatch: 0,
          isInFlow: false,
          totalMatchesPurchased: 0,
          totalMatchesUsed: 0,
          totalMatchesRemaining: 0,
        },
        select: {
          id: true,
          refundCooldownUntil: true,
        },
      });
      this.logger.log(`Created new Intent for user ${userId}: ${intent.id}`);
    }

    await this.syncIntentLinks(userId, intent.id);

    // 4. Create Payment record in PENDING status
    const payment = await this.prisma.payment.create({
      data: {
        stripeCheckoutSessionId: `pending_${Date.now()}`, // Temporary, will be updated
        planType,
        matchesInitial: pack.matches,
        matchesUsed: 0,
        amountBase: amounts.amountBase,
        amountFees: amounts.amountFees,
        amountTotal: amounts.amountTotal,
        pricePerMatch,
        currency: 'eur',
        status: PaymentStatus.PENDING,
        userId,
        intentId: intent.id,
      },
    });

    // 5. Create Transaction record
    await this.prisma.transaction.create({
      data: {
        type: TransactionType.PAYMENT_CREATED,
        status: TransactionStatus.PENDING,
        stripeObjectId: null, // Will be updated with session ID
        amountBase: amounts.amountBase,
        amountFees: amounts.amountFees,
        amountTotal: amounts.amountTotal,
        currency: 'eur',
        metadata: { planType, matches: pack.matches },
        paymentId: payment.id,
        userId,
      },
    });

    // 6. Create Stripe Checkout session
    const session = await this.stripeService.createCheckoutSession({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'eur',
            product_data: {
              name: `Pack ${pack.labelFr} - ${pack.matches} matchs`,
              description: pack.description,
            },
            unit_amount: eurosToCents(amounts.amountTotal),
          },
          quantity: 1,
        },
      ],
      success_url: `${this.frontendUrl}/dashboard?payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${this.frontendUrl}/dashboard?payment=cancel`,
      metadata: {
        userId: userId.toString(),
        intentId: intent.id.toString(),
        paymentId: payment.id.toString(),
        planType,
        matchesInitial: pack.matches.toString(),
        amountBase: amounts.amountBase.toString(),
      },
      customer_email: undefined, // Could add user email here
    });

    // 7. Update Payment with real Stripe session ID
    await this.prisma.payment.update({
      where: { id: payment.id },
      data: { stripeCheckoutSessionId: session.id },
    });

    // 8. Update Transaction with session ID
    await this.prisma.transaction.updateMany({
      where: { paymentId: payment.id, type: TransactionType.PAYMENT_CREATED },
      data: { stripeObjectId: session.id },
    });

    this.logger.log(
      `Checkout session created for user ${userId}, payment ${payment.id}: ${session.id}`,
    );

    return {
      url: session.url!,
      sessionId: session.id,
    };
  }

  /**
   * Get matching summary for a user (for Dashboard)
   *
   * UPDATED: Now includes refund cooldown and matching processing state.
   * Frontend uses this to:
   * - Show cooldown warning if user recently got a refund
   * - Block refund button if matching is in progress
   * - Show appropriate messages to the user
   */
  async getMatchingSummary(userId: number): Promise<MatchingSummaryDto> {
    // Get Intent with new fields
    const intent = (await this.prisma.intent.findFirst({
      where: { userId },
    })) as any; // Cast until Prisma client is regenerated with new fields

    // Get all payments for this user
    const payments = await this.prisma.payment.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    // Map payments to summary DTOs
    const paymentSummaries: PaymentSummaryDto[] = payments.map((p) => ({
      id: p.id,
      planType: p.planType,
      matchesInitial: p.matchesInitial,
      matchesUsed: p.matchesUsed,
      matchesRefunded: p.matchesRefunded ?? 0,
      matchesRemaining:
        p.matchesInitial - p.matchesUsed - (p.matchesRefunded ?? 0),
      amountBase: p.amountBase,
      amountTotal: p.amountTotal,
      pricePerMatch: p.pricePerMatch,
      status: p.status,
      createdAt: p.createdAt,
      succeededAt: p.succeededAt,
      refundedAt: p.refundedAt,
    }));

    // Calculate potential refund (unused matches from SUCCEEDED payments)
    const { unusedMatches, refundAmount } =
      this.calculatePotentialRefund(payments);

    // Calculate cooldown state
    const now = new Date();
    const refundCooldownUntil = intent?.refundCooldownUntil ?? null;
    const isCooldownActive =
      refundCooldownUntil && new Date(refundCooldownUntil) > now;
    const refundCooldownRemainingMs = isCooldownActive
      ? new Date(refundCooldownUntil).getTime() - now.getTime()
      : null;

    // Calculate matching processing state
    const matchingProcessingUntil = intent?.matchingProcessingUntil ?? null;
    const isMatchingInProgress =
      matchingProcessingUntil && new Date(matchingProcessingUntil) > now;

    // Determine blocking reason (if any)
    let blockingReason: string | null = null;
    if (isCooldownActive) {
      blockingReason = 'REFUND_COOLDOWN_ACTIVE';
    }

    return {
      totalMatchesPurchased: intent?.totalMatchesPurchased || 0,
      totalMatchesUsed: intent?.totalMatchesUsed || 0,
      totalMatchesRemaining: intent?.totalMatchesRemaining || 0,
      isInFlow: intent?.isInFlow || false,
      payments: paymentSummaries,
      canRequestRefund: unusedMatches > 0 && !isMatchingInProgress,
      potentialRefundAmount: refundAmount,

      // Cooldown state
      refundCooldownUntil: refundCooldownUntil
        ? new Date(refundCooldownUntil).toISOString()
        : null,
      refundCooldownRemainingMs,
      canBuyNewPack: !isCooldownActive,

      // Matching processing state
      matchingProcessingUntil: matchingProcessingUntil
        ? new Date(matchingProcessingUntil).toISOString()
        : null,
      isRefundBlockedByMatching: !!isMatchingInProgress,

      // Blocking reason
      blockingReason,
    };
  }

  /**
   * Calculate potential refund amount from all payments
   */
  private calculatePotentialRefund(
    payments: Array<{
      status: string;
      matchesInitial: number;
      matchesUsed: number;
      matchesRefunded?: number;
      pricePerMatch: number;
    }>,
  ): { unusedMatches: number; refundAmount: number } {
    let totalUnused = 0;
    let totalRefund = 0;

    for (const payment of payments) {
      // Only consider SUCCEEDED or PARTIALLY_REFUNDED payments
      if (
        payment.status === PaymentStatus.SUCCEEDED ||
        payment.status === PaymentStatus.PARTIALLY_REFUNDED
      ) {
        const refunded = payment.matchesRefunded ?? 0;
        const unused = payment.matchesInitial - payment.matchesUsed - refunded;
        if (unused > 0) {
          totalUnused += unused;
          totalRefund += calculateRefundAmount(payment.pricePerMatch, unused);
        }
      }
    }

    return {
      unusedMatches: totalUnused,
      refundAmount: Math.round(totalRefund * 100) / 100,
    };
  }

  /**
   * Request a refund for unused matches
   * Uses FIFO: oldest payments are refunded first
   *
   * IMPORTANT BLOCKING RULES:
   * 1. Cannot refund if matching is in progress (matchingProcessingUntil > now)
   *    This prevents inconsistencies where matches are created during refund.
   * 2. After refund, a cooldown period is applied (REFUND_REBUY_COOLDOWN_DAYS)
   *    This prevents abuse (buy -> test -> refund -> repeat).
   */
  async requestRefund(userId: number): Promise<RefundResponseDto> {
    // 0. CHECK IF MATCHING IS IN PROGRESS
    // If a worker is currently processing this intent, block the refund.
    // This prevents race conditions where matches are created during refund.
    const intent = await this.prisma.intent.findFirst({
      where: { userId },
      select: {
        id: true,
        matchingProcessingUntil: true,
        matchingProcessingBy: true,
      },
    });

    if (
      intent?.matchingProcessingUntil &&
      intent.matchingProcessingUntil > new Date()
    ) {
      this.logger.warn(
        `User ${userId} refund blocked: matching in progress by ${intent.matchingProcessingBy} until ${intent.matchingProcessingUntil.toISOString()}`,
      );

      throw new ConflictException({
        code: MatchingErrorCode.MATCHING_IN_PROGRESS,
        message:
          'Recherche en cours sur votre profil. Réessayez dans quelques minutes.',
        retryAfter: intent.matchingProcessingUntil.toISOString(),
      });
    }

    // 1. Get all SUCCEEDED payments with unused matches, ordered by createdAt (FIFO)
    const payments = await this.prisma.payment.findMany({
      where: {
        userId,
        status: {
          in: [PaymentStatus.SUCCEEDED, PaymentStatus.PARTIALLY_REFUNDED],
        },
      },
      orderBy: { createdAt: 'asc' }, // FIFO - oldest first
    });

    // 2. Calculate what can be refunded
    const refundablePayments: Array<{
      payment: (typeof payments)[0];
      unusedMatches: number;
      refundAmount: number;
    }> = [];

    let totalUnusedMatches = 0;
    let totalRefundAmount = 0;

    for (const payment of payments) {
      const refunded = payment.matchesRefunded ?? 0;
      const unused = payment.matchesInitial - payment.matchesUsed - refunded;
      if (unused > 0 && payment.stripeChargeId) {
        const refundAmount = calculateRefundAmount(
          payment.pricePerMatch,
          unused,
        );
        refundablePayments.push({
          payment,
          unusedMatches: unused,
          refundAmount,
        });
        totalUnusedMatches += unused;
        totalRefundAmount += refundAmount;
      }
    }

    if (refundablePayments.length === 0) {
      throw new BadRequestException(
        'Aucun match non utilisé à rembourser, ou les paiements ne sont pas éligibles.',
      );
    }

    // 3. Process refunds in a transaction
    const result = await this.prisma.$transaction(async (tx) => {
      let successfulRefunds = 0;
      let refundedMatches = 0;
      let refundedAmount = 0;

      for (const {
        payment,
        unusedMatches,
        refundAmount,
      } of refundablePayments) {
        try {
          // Create Stripe refund (amount in cents)
          const refund = await this.stripeService.createRefund(
            payment.stripeChargeId!,
            eurosToCents(refundAmount),
            {
              paymentId: payment.id.toString(),
              userId: userId.toString(),
              unusedMatches: unusedMatches.toString(),
            },
          );

          if (refund) {
            const newMatchesRefunded =
              (payment.matchesRefunded ?? 0) + unusedMatches;
            const remainingAfter =
              payment.matchesInitial - payment.matchesUsed - newMatchesRefunded;
            if (remainingAfter < 0) {
              throw new Error(
                `Refund exceeds available matches for payment ${payment.id}`,
              );
            }

            await tx.payment.update({
              where: { id: payment.id },
              data: {
                stripeRefundId: refund.id,
                status:
                  remainingAfter > 0
                    ? PaymentStatus.PARTIALLY_REFUNDED
                    : PaymentStatus.REFUNDED,
                refundedAt: new Date(),
                matchesRefunded: newMatchesRefunded,
              },
            });

            // Create Transaction for refund request
            await tx.transaction.create({
              data: {
                type: TransactionType.REFUND_REQUESTED,
                status: TransactionStatus.PENDING,
                stripeObjectId: refund.id,
                amountBase: refundAmount,
                amountFees: 0,
                amountTotal: refundAmount,
                currency: 'eur',
                metadata: { unusedMatches, chargeId: payment.stripeChargeId },
                paymentId: payment.id,
                userId,
              },
            });

            successfulRefunds++;
            refundedMatches += unusedMatches;
            refundedAmount += refundAmount;

            this.logger.log(
              `Refund created for payment ${payment.id}: ${refund.id}, amount: ${refundAmount}€`,
            );
          }
        } catch (err) {
          this.logger.error(
            `Failed to refund payment ${payment.id}: ${err.message}`,
          );
          // Continue with other payments
        }
      }

      // 4. Update Intent credits and set refund cooldown
      // Calculate cooldown end date (default 14 days) - always calculate for return value
      const cooldownDays = this.matchingConfig.refundCooldownDays;
      const cooldownUntil = new Date(
        Date.now() + cooldownDays * 24 * 60 * 60 * 1000,
      );

      if (refundedMatches > 0) {
        const intentToUpdate = await tx.intent.findFirst({ where: { userId } });
        if (intentToUpdate) {
          const newRemaining = Math.max(
            0,
            intentToUpdate.totalMatchesRemaining - refundedMatches,
          );

          await tx.intent.update({
            where: { id: intentToUpdate.id },
            data: {
              totalMatchesRemaining: newRemaining,
              isInFlow: newRemaining > 0,
              // SET REFUND COOLDOWN
              // User cannot buy a new pack until this date
              refundCooldownUntil: cooldownUntil,
              lastRefundAt: new Date(),
            },
          });

          this.logger.log(
            `User ${userId} refund cooldown set until ${cooldownUntil.toISOString()} (${cooldownDays} days)`,
          );
        }
      }

      return {
        successfulRefunds,
        refundedMatches,
        refundedAmount,
        cooldownUntil,
      };
    });

    // Send refund confirmation email (non-blocking)
    if (result.successfulRefunds > 0) {
      this.sendRefundEmailAsync(
        userId,
        result.refundedAmount,
        result.refundedMatches,
        result.cooldownUntil,
      );
    }

    return {
      success: result.successfulRefunds > 0,
      message:
        result.successfulRefunds > 0
          ? `Demande de remboursement enregistrée. ${result.refundedMatches} matchs seront remboursés.`
          : "Aucun remboursement n'a pu être effectué.",
      refundedAmount: result.refundedAmount,
      matchesRefunded: result.refundedMatches,
    };
  }

  /**
   * Send refund confirmation email asynchronously (fire-and-forget)
   */
  private async sendRefundEmailAsync(
    userId: number,
    refundAmount: number,
    matchesRefunded: number,
    cooldownEndDate: Date,
  ): Promise<void> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { mail: true, firstName: true, lastName: true },
      });

      if (!user?.mail) {
        this.logger.warn(
          `Cannot send refund email: no email for user ${userId}`,
        );
        return;
      }

      const userName = user.firstName || user.lastName || 'Utilisateur';
      const transactionId = `REF-${Date.now()}-${userId}`;

      await this.mailService.sendRefundConfirmationEmail(
        user.mail,
        userName,
        refundAmount,
        matchesRefunded,
        cooldownEndDate,
        transactionId,
      );

      this.logger.log(`Refund confirmation email sent to ${user.mail}`);
    } catch (error) {
      this.logger.error(
        `Failed to send refund email for user ${userId}: ${error.message}`,
      );
      // Don't throw - email failure shouldn't break the refund flow
    }
  }

  /**
   * Handle successful payment from webhook
   * Called when checkout.session.completed is received
   */
  async handlePaymentSuccess(
    sessionId: string,
    paymentIntentId: string,
    chargeId: string | null,
    stripeEventId: string,
  ): Promise<void> {
    let missingLinksWarning: string | null = null;
    let totalCreditsAfterPurchase = 0;

    // Check for idempotency - was this event already processed?
    const existingTx = await this.prisma.transaction.findUnique({
      where: { stripeEventId },
    });
    if (existingTx) {
      this.logger.log(`Event ${stripeEventId} already processed, skipping`);
      return;
    }

    // Find the payment by session ID
    const payment = await this.prisma.payment.findUnique({
      where: { stripeCheckoutSessionId: sessionId },
      include: { intent: true },
    });

    if (!payment) {
      this.logger.error(`Payment not found for session ${sessionId}`);
      return;
    }

    if (payment.status === PaymentStatus.SUCCEEDED) {
      this.logger.log(`Payment ${payment.id} already succeeded, skipping`);
      return;
    }

    // Update in transaction
    await this.prisma.$transaction(async (tx) => {
      const intent = await tx.intent.findUnique({
        where: { id: payment.intentId },
        select: {
          id: true,
          homeId: true,
          searchId: true,
          totalMatchesPurchased: true,
          totalMatchesRemaining: true,
        },
      });

      let homeId = intent?.homeId ?? null;
      let searchId = intent?.searchId ?? null;

      if (!homeId) {
        const home = await tx.home.findUnique({
          where: { userId: payment.userId },
          select: { id: true },
        });
        if (home) {
          homeId = home.id;
        }
      }

      if (!searchId) {
        const search = await tx.search.findFirst({
          where: { userId: payment.userId },
          select: { id: true },
        });
        if (search) {
          searchId = search.id;
        }
      }

      const missing: string[] = [];
      if (!homeId) missing.push('homeId');
      if (!searchId) missing.push('searchId');
      if (missing.length > 0) {
        missingLinksWarning = `Intent ${intent?.id} missing ${missing.join(
          ' + ',
        )} at payment success - credits added but user kept out of flow`;
      }

      // Update Payment
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.SUCCEEDED,
          stripePaymentIntentId: paymentIntentId,
          stripeChargeId: chargeId,
          succeededAt: new Date(),
        },
      });

      // Update Intent credits
      const updatedIntent = await tx.intent.update({
        where: { id: payment.intentId },
        data: {
          totalMatchesPurchased: {
            increment: payment.matchesInitial,
          },
          totalMatchesRemaining: {
            increment: payment.matchesInitial,
          },
          homeId,
          searchId,
          isInFlow:
            !!homeId && !!searchId
              ? {
                  set: true,
                }
              : false,
        },
      });

      totalCreditsAfterPurchase = updatedIntent.totalMatchesRemaining;

      // Create Transaction
      await tx.transaction.create({
        data: {
          type: TransactionType.PAYMENT_SUCCEEDED,
          status: TransactionStatus.SUCCEEDED,
          stripeEventId,
          stripeObjectId: sessionId,
          amountBase: payment.amountBase,
          amountFees: payment.amountFees,
          amountTotal: payment.amountTotal,
          currency: 'eur',
          metadata: {
            paymentIntentId,
            chargeId,
            planType: payment.planType,
            matches: payment.matchesInitial,
          },
          paymentId: payment.id,
          userId: payment.userId,
        },
      });
    });

    if (missingLinksWarning) {
      this.logger.warn(missingLinksWarning);
    } else {
      this.logger.log(
        `Payment ${payment.id} marked as SUCCEEDED, ${payment.matchesInitial} matches credited to user ${payment.userId}`,
      );
    }

    // Send payment success email (non-blocking)
    this.sendPaymentSuccessEmailAsync(
      payment.userId,
      payment.planType,
      payment.matchesInitial,
      payment.amountTotal,
      totalCreditsAfterPurchase,
      payment.id.toString(),
    );
  }

  /**
   * Send payment success email asynchronously (fire-and-forget)
   */
  private async sendPaymentSuccessEmailAsync(
    userId: number,
    planType: string,
    matchesPurchased: number,
    amountTotal: number,
    totalCredits: number,
    transactionId: string,
  ): Promise<void> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { mail: true, firstName: true, lastName: true },
      });

      if (!user?.mail) {
        this.logger.warn(
          `Cannot send payment success email: no email for user ${userId}`,
        );
        return;
      }

      const userName = user.firstName || user.lastName || 'Utilisateur';
      const pack = getPackByType(planType as MatchPackType);
      const packLabel = pack?.labelFr || planType;

      await this.mailService.sendPaymentSuccessEmail(
        user.mail,
        userName,
        packLabel,
        matchesPurchased,
        amountTotal,
        totalCredits,
        `PAY-${transactionId}`,
      );

      this.logger.log(`Payment success email sent to ${user.mail}`);
    } catch (error) {
      this.logger.error(
        `Failed to send payment success email for user ${userId}: ${error.message}`,
      );
      // Don't throw - email failure shouldn't break the payment flow
    }
  }

  /**
   * Handle failed payment from webhook
   */
  async handlePaymentFailure(
    sessionId: string,
    stripeEventId: string,
    failureReason?: string,
  ): Promise<void> {
    // Check for idempotency
    const existingTx = await this.prisma.transaction.findUnique({
      where: { stripeEventId },
    });
    if (existingTx) {
      this.logger.log(`Event ${stripeEventId} already processed, skipping`);
      return;
    }

    const payment = await this.prisma.payment.findUnique({
      where: { stripeCheckoutSessionId: sessionId },
    });

    if (!payment) {
      this.logger.error(`Payment not found for session ${sessionId}`);
      return;
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: payment.id },
        data: { status: PaymentStatus.FAILED },
      });

      await tx.transaction.create({
        data: {
          type: TransactionType.PAYMENT_FAILED,
          status: TransactionStatus.FAILED,
          stripeEventId,
          stripeObjectId: sessionId,
          amountBase: payment.amountBase,
          amountFees: payment.amountFees,
          amountTotal: payment.amountTotal,
          currency: 'eur',
          metadata: { failureReason },
          paymentId: payment.id,
          userId: payment.userId,
        },
      });
    });

    this.logger.log(`Payment ${payment.id} marked as FAILED`);

    // Send payment failure email (non-blocking)
    this.sendPaymentFailedEmailAsync(
      payment.userId,
      payment.planType,
      payment.amountTotal,
      sessionId,
    );
  }

  /**
   * Send payment failure email asynchronously (fire-and-forget)
   */
  private async sendPaymentFailedEmailAsync(
    userId: number,
    planType: string,
    amountTotal: number,
    sessionId: string,
  ): Promise<void> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { mail: true, firstName: true, lastName: true },
      });

      if (!user?.mail) {
        this.logger.warn(
          `Cannot send payment failure email: no email for user ${userId}`,
        );
        return;
      }

      const userName = user.firstName || user.lastName || 'Utilisateur';
      const pack = getPackByType(planType as MatchPackType);
      const packLabel = pack?.labelFr || planType;

      await this.mailService.sendPaymentFailedEmail(
        user.mail,
        userName,
        packLabel,
        amountTotal,
        sessionId,
      );

      this.logger.log(`Payment failure email sent to ${user.mail}`);
    } catch (error) {
      this.logger.error(
        `Failed to send payment failure email for user ${userId}: ${error.message}`,
      );
      // Don't throw - email failure shouldn't break the flow
    }
  }

  /**
   * Handle refund success from webhook
   */
  async handleRefundSuccess(
    refundId: string,
    chargeId: string,
    stripeEventId: string,
    amountRefunded: number,
  ): Promise<void> {
    // Check for idempotency
    const existingTx = await this.prisma.transaction.findUnique({
      where: { stripeEventId },
    });
    if (existingTx) {
      this.logger.log(`Event ${stripeEventId} already processed, skipping`);
      return;
    }

    // Find payment by charge ID
    const payment = await this.prisma.payment.findFirst({
      where: { stripeChargeId: chargeId },
    });

    if (!payment) {
      this.logger.error(`Payment not found for charge ${chargeId}`);
      return;
    }

    await this.prisma.transaction.create({
      data: {
        type: TransactionType.REFUND_SUCCEEDED,
        status: TransactionStatus.SUCCEEDED,
        stripeEventId,
        stripeObjectId: refundId,
        amountTotal: amountRefunded / 100, // Convert from cents
        currency: 'eur',
        metadata: { chargeId },
        paymentId: payment.id,
        userId: payment.userId,
      },
    });

    this.logger.log(
      `Refund ${refundId} succeeded for payment ${payment.id}, amount: ${amountRefunded / 100}€`,
    );

    // TODO: Send refund success email
    console.log('TODO: send refund success email');
  }

  /**
   * Handle refund failure from webhook
   */
  async handleRefundFailure(
    refundId: string,
    chargeId: string,
    stripeEventId: string,
    failureReason?: string,
  ): Promise<void> {
    // Check for idempotency
    const existingTx = await this.prisma.transaction.findUnique({
      where: { stripeEventId },
    });
    if (existingTx) {
      this.logger.log(`Event ${stripeEventId} already processed, skipping`);
      return;
    }

    const payment = await this.prisma.payment.findFirst({
      where: { stripeChargeId: chargeId },
    });

    if (!payment) {
      this.logger.error(`Payment not found for charge ${chargeId}`);
      return;
    }

    // Revert payment status if it was marked as refunded
    await this.prisma.$transaction(async (tx) => {
      if (payment.status === PaymentStatus.REFUNDED) {
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: PaymentStatus.SUCCEEDED,
            stripeRefundId: null,
            refundedAt: null,
          },
        });
      }

      await tx.transaction.create({
        data: {
          type: TransactionType.REFUND_FAILED,
          status: TransactionStatus.FAILED,
          stripeEventId,
          stripeObjectId: refundId,
          metadata: { chargeId, failureReason },
          paymentId: payment.id,
          userId: payment.userId,
        },
      });
    });

    this.logger.error(
      `Refund ${refundId} failed for payment ${payment.id}: ${failureReason}`,
    );

    // TODO: Send refund failure email
    console.log('TODO: send refund failure email');
  }

  /**
   * Consume one match credit from an Intent (FIFO)
   * Called when a match is created
   */
  /**
   * Consume one match credit from an Intent (FIFO)
   */
  async consumeMatchCredit(intentId: number): Promise<boolean> {
    // 1. Récupérer les paiements candidats (Succès ou Partiel)
    // On trie par date pour respecter le FIFO (First In, First Out)
    const payments = await this.prisma.payment.findMany({
      where: {
        intentId,
        status: {
          in: [PaymentStatus.SUCCEEDED, PaymentStatus.PARTIALLY_REFUNDED],
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    // 2. Filtrage LOGIQUE (JavaScript)
    // On cherche le premier paiement où il reste des matchs (Initial - Used - Refunded > 0)
    const paymentToConsume = payments.find((p) => {
      const refunded = p.matchesRefunded ?? 0;
      return p.matchesInitial - p.matchesUsed - refunded > 0;
    });

    if (!paymentToConsume) {
      this.logger.warn(`No available matches for intent ${intentId}`);
      return false;
    }

    // 3. Mise à jour transactionnelle
    await this.prisma.$transaction(async (tx) => {
      // Incrémenter matchesUsed sur le paiement
      await tx.payment.update({
        where: { id: paymentToConsume.id },
        data: { matchesUsed: { increment: 1 } },
      });

      // Mettre à jour l'Intent
      await tx.intent.update({
        where: { id: intentId },
        data: {
          totalMatchesUsed: { increment: 1 },
          totalMatchesRemaining: { decrement: 1 },
        },
      });

      // Sécurité : Vérifier qu'on ne passe pas en négatif
      const updatedIntent = await tx.intent.findUnique({
        where: { id: intentId },
      });
      if (updatedIntent && updatedIntent.totalMatchesRemaining <= 0) {
        await tx.intent.update({
          where: { id: intentId },
          data: { isInFlow: false },
        });
      }
    });

    return true;
  }

  private async syncIntentLinks(
    userId: number,
    intentId: number,
  ): Promise<void> {
    const intent = await this.prisma.intent.findUnique({
      where: { id: intentId },
      select: { id: true, homeId: true, searchId: true },
    });

    if (!intent) return;

    let homeId = intent.homeId;
    let searchId = intent.searchId;

    if (!homeId) {
      const home = await this.prisma.home.findUnique({
        where: { userId },
        select: { id: true },
      });
      homeId = home?.id ?? null;
    }

    if (!searchId) {
      const search = await this.prisma.search.findFirst({
        where: { userId },
        select: { id: true },
      });
      searchId = search?.id ?? null;
    }

    if (homeId || searchId) {
      await this.prisma.intent.update({
        where: { id: intent.id },
        data: {
          homeId: homeId ?? undefined,
          searchId: searchId ?? undefined,
        },
      });
    }
  }
}
