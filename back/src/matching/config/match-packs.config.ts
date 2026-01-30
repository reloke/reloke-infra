/**
 * Match Packs Configuration
 *
 * Central configuration for all available match packs.
 * Used by both backend (payment creation) and can be mirrored in frontend.
 *
 * Pricing Rule - "Prix Tout Inclus":
 * - Le prix affiché est le prix final (frais Stripe absorbés par la plateforme)
 * - Les frais sont déduits du baseAmount côté plateforme
 * - Remboursement au prorata du prix/match sur les matchs non utilisés
 */

export type MatchPackType = 'PACK_DISCOVERY' | 'PACK_STANDARD' | 'PACK_PRO';

export interface MatchPackConfig {
  planType: MatchPackType;
  label: string;
  labelFr: string;
  matches: number;
  baseAmount: number; // Prix tout inclus en euros (ce que le client paie)
  description: string;
  isRecommended?: boolean;
}

/**
 * Available match packs - Nouvelle grille tarifaire
 *
 * Pack 1 "Le Curieux": 12€ pour 2 matchs (6€/match)
 * Pack 2 "L'Efficace": 25€ pour 5 matchs (5€/match) - Recommandé
 * Pack 3 "Le Déterminé": 60€ pour 15 matchs (4€/match)
 */
export const MATCH_PACKS: MatchPackConfig[] = [
  {
    planType: 'PACK_DISCOVERY',
    label: 'Le Curieux',
    labelFr: 'Le Curieux',
    matches: 2,
    baseAmount: 12.0,
    description: 'Pour tester le marché sans risque.',
    isRecommended: false,
  },
  {
    planType: 'PACK_STANDARD',
    label: "L'Efficace",
    labelFr: "L'Efficace",
    matches: 5,
    baseAmount: 25.0,
    description: "L'offre idéale : 5 opportunités ciblées.",
    isRecommended: true,
  },
  {
    planType: 'PACK_PRO',
    label: 'Le Déterminé',
    labelFr: 'Le Déterminé',
    matches: 15,
    baseAmount: 60.0,
    description: 'Pour une recherche intensive et rapide.',
    isRecommended: false,
  },
];

/**
 * Stripe fee calculation constants
 * Ces frais sont absorbés par la plateforme (déduits du baseAmount)
 * Using 3.5% + 0.25€ to cover EU card fees with margin
 */
const STRIPE_FEE_PERCENTAGE = 0; // 3.5%
const STRIPE_FEE_FIXED = 0; // 0.25€

/**
 * Compute the amounts for a pack - "Prix Tout Inclus" model
 *
 * Le client paie baseAmount (prix affiché = prix final)
 * Les frais Stripe sont absorbés/déduits côté plateforme
 *
 * @param baseAmount The pack total price in euros (what client pays)
 * @returns Object with base, fees (internal), and total amounts
 */
export function computeClientAmounts(baseAmount: number): {
  amountBase: number;
  amountFees: number;
  amountTotal: number;
} {
  // Frais Stripe calculés pour info interne (absorbés par la plateforme)
  const fees = baseAmount * STRIPE_FEE_PERCENTAGE + STRIPE_FEE_FIXED;

  return {
    amountBase: Math.round(baseAmount * 100) / 100,
    amountFees: Math.round(fees * 100) / 100, // Frais absorbés (pour info)
    amountTotal: Math.round(baseAmount * 100) / 100, // Total = Base (prix tout inclus)
  };
}

/**
 * Convert euros to cents for Stripe API
 */
export function eurosToCents(euros: number): number {
  return Math.round(euros * 100);
}

/**
 * Convert cents to euros
 */
export function centsToEuros(cents: number): number {
  return cents / 100;
}

/**
 * Get a pack configuration by its type
 */
export function getPackByType(
  planType: MatchPackType,
): MatchPackConfig | undefined {
  return MATCH_PACKS.find((pack) => pack.planType === planType);
}

/**
 * Calculate the price per match for a pack
 */
export function calculatePricePerMatch(
  baseAmount: number,
  matches: number,
): number {
  return Math.round((baseAmount / matches) * 100) / 100;
}

/**
 * Calculate refund amount for unused matches - "Remboursement au prorata"
 *
 * Avec le modèle "Prix Tout Inclus", le remboursement est simple :
 * - pricePerMatch = baseAmount / matches (prix payé par match)
 * - Remboursement = pricePerMatch × nombre de matchs non utilisés
 *
 * Exemple: Pack "L'Efficace" 25€ pour 5 matchs (5€/match)
 *          3 matchs non utilisés → Remboursement = 3 × 5€ = 15€
 *
 * @param pricePerMatch Price per match from original payment
 * @param unusedMatches Number of unused matches
 * @returns Refund amount in euros
 */
export function calculateRefundAmount(
  pricePerMatch: number,
  unusedMatches: number,
): number {
  return Math.round(pricePerMatch * unusedMatches * 100) / 100;
}

/**
 * Payment status enum for consistency
 */
export enum PaymentStatus {
  PENDING = 'PENDING',
  SUCCEEDED = 'SUCCEEDED',
  FAILED = 'FAILED',
  PARTIALLY_REFUNDED = 'PARTIALLY_REFUNDED',
  REFUNDED = 'REFUNDED',
}

/**
 * Transaction type enum for consistency
 */
export enum TransactionType {
  PAYMENT_CREATED = 'PAYMENT_CREATED',
  PAYMENT_SUCCEEDED = 'PAYMENT_SUCCEEDED',
  PAYMENT_FAILED = 'PAYMENT_FAILED',
  REFUND_REQUESTED = 'REFUND_REQUESTED',
  REFUND_SUCCEEDED = 'REFUND_SUCCEEDED',
  REFUND_FAILED = 'REFUND_FAILED',
}

/**
 * Transaction status enum
 */
export enum TransactionStatus {
  PENDING = 'PENDING',
  SUCCEEDED = 'SUCCEEDED',
  FAILED = 'FAILED',
}
