import { IsEnum, IsNotEmpty } from 'class-validator';
import type { MatchPackType } from '../config/match-packs.config';

/**
 * DTO for creating a checkout session
 */
export class CreateCheckoutSessionDto {
  @IsNotEmpty({ message: 'Le type de pack est requis' })
  @IsEnum(['PACK_DISCOVERY', 'PACK_STANDARD', 'PACK_PRO'], {
    message: 'Type de pack invalide',
  })
  planType: 'PACK_DISCOVERY' | 'PACK_STANDARD' | 'PACK_PRO';
}

/**
 * Response DTO for checkout session creation
 */
export class CheckoutSessionResponseDto {
  url: string;
  sessionId: string;
}

/**
 * Response DTO for matching summary
 *
 * UPDATED: Now includes refund cooldown and blocking information.
 */
export class MatchingSummaryDto {
  // Intent credit state
  totalMatchesPurchased: number;
  totalMatchesUsed: number;
  totalMatchesRemaining: number;
  isInFlow: boolean;

  // Payment history
  payments: PaymentSummaryDto[];

  // Refund eligibility
  canRequestRefund: boolean;
  potentialRefundAmount: number;

  // === REFUND COOLDOWN ===
  // If set, user cannot buy a new pack until this date
  refundCooldownUntil: string | null;
  // Remaining time in milliseconds (for frontend display)
  refundCooldownRemainingMs: number | null;
  // Whether user can currently buy a new pack
  canBuyNewPack: boolean;

  // === MATCHING PROCESSING ===
  // If set, matching is in progress until this date (blocks refund)
  matchingProcessingUntil: string | null;
  // Whether refund is currently blocked due to matching
  isRefundBlockedByMatching: boolean;

  // === BLOCKING REASON ===
  // Human-readable reason if any action is blocked
  // Possible values: null, 'REFUND_COOLDOWN_ACTIVE', 'MATCHING_IN_PROGRESS'
  blockingReason: string | null;
}

/**
 * Summary of a single payment
 */
export class PaymentSummaryDto {
  id: number;
  planType: string;
  matchesInitial: number;
  matchesUsed: number;
  matchesRefunded: number;
  matchesRemaining: number;
  amountBase: number;
  amountTotal: number;
  pricePerMatch: number;
  status: string;
  createdAt: Date;
  succeededAt: Date | null;
  refundedAt: Date | null;
}

/**
 * Response DTO for refund request
 */
export class RefundResponseDto {
  success: boolean;
  message: string;
  refundedAmount: number;
  matchesRefunded: number;
}

/**
 * Pack info for frontend display
 */
export class PackInfoDto {
  planType: 'PACK_DISCOVERY' | 'PACK_STANDARD' | 'PACK_PRO';
  label: string;
  labelFr: string;
  matches: number;
  baseAmount: number;
  fees: number;
  totalAmount: number;
  pricePerMatch: number;
  description: string;
  isRecommended: boolean;
}
