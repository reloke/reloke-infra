import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { MatchingPaymentsService } from '../services/matching-payments.service';
import {
  CreateCheckoutSessionDto,
  CheckoutSessionResponseDto,
  MatchingSummaryDto,
  RefundResponseDto,
  PackInfoDto,
} from '../dto/matching-payments.dto';

/**
 * Matching Payments Controller
 *
 * REST API for:
 * - Getting available packs
 * - Creating checkout sessions
 * - Getting user's matching summary
 * - Requesting refunds
 *
 * All endpoints require authentication (JWT)
 */
@Controller('matching')
@UseGuards(AuthGuard('jwt'))
export class MatchingPaymentsController {
  constructor(
    private readonly matchingPaymentsService: MatchingPaymentsService,
  ) {}

  /**
   * GET /matching/packs
   *
   * Get all available match packs with pricing
   * Used by frontend to display pack cards
   */
  @Get('packs')
  async getAvailablePacks(): Promise<PackInfoDto[]> {
    return this.matchingPaymentsService.getAvailablePacks();
  }

  /**
   * POST /matching/payments/checkout-session
   *
   * Create a Stripe Checkout session for purchasing a pack
   * Returns URL to redirect user to Stripe
   */
  @Post('payments/checkout-session')
  @HttpCode(HttpStatus.OK)
  async createCheckoutSession(
    @Request() req: any,
    @Body() dto: CreateCheckoutSessionDto,
  ): Promise<CheckoutSessionResponseDto> {
    const userId = req.user?.userId || req.user?.id;
    const isBanned = req.user?.isBanned || false;

    if (!userId) {
      throw new BadRequestException('Utilisateur non authentifié');
    }

    if (isBanned) {
      throw new ForbiddenException('Compte banni : achat de packs impossible.');
    }

    const result = await this.matchingPaymentsService.createCheckoutSession(
      userId,
      dto.planType,
    );

    return {
      url: result.url,
      sessionId: result.sessionId,
    };
  }

  /**
   * GET /matching/summary
   *
   * Get user's matching summary for Dashboard
   * Includes credits, payments history, refund eligibility
   */
  @Get('summary')
  async getMatchingSummary(@Request() req: any): Promise<MatchingSummaryDto> {
    const userId = req.user?.userId || req.user?.id;

    if (!userId) {
      throw new BadRequestException('Utilisateur non authentifié');
    }

    return this.matchingPaymentsService.getMatchingSummary(userId);
  }

  /**
   * POST /matching/refund
   *
   * Request a refund for unused matches
   * User must have unused matches from SUCCEEDED payments
   */
  @Post('refund')
  @HttpCode(HttpStatus.OK)
  async requestRefund(@Request() req: any): Promise<RefundResponseDto> {
    const userId = req.user?.userId || req.user?.id;

    if (!userId) {
      throw new BadRequestException('Utilisateur non authentifié');
    }

    return this.matchingPaymentsService.requestRefund(userId);
  }
}
