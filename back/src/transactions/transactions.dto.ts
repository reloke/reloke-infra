import { IsOptional, IsInt, Min, Max, IsString } from 'class-validator';
import { Type } from 'class-transformer';

// ============================================================
// Query DTOs
// ============================================================

/**
 * Query params for desktop table pagination (page/size based)
 */
export class GetTransactionsTableQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;
}

/**
 * Query params for mobile feed (cursor-based infinite scroll)
 */
export class GetTransactionsFeedQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 20;

  @IsOptional()
  @IsString()
  cursor?: string;
}

// ============================================================
// Response DTOs
// ============================================================

/**
 * Single transaction item for list display
 * Excludes metadata to reduce payload size
 */
export interface TransactionListItemDto {
  id: number;
  occurredAt: string; // ISO date string
  type: string;
  status: string;
  amountTotal: number | null;
  currency: string | null;
  stripeObjectId: string | null;
  paymentId: number | null;
}

/**
 * Desktop table response with page-based pagination
 */
export interface TransactionTableResponseDto {
  items: TransactionListItemDto[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/**
 * Mobile feed response with cursor-based pagination
 */
export interface TransactionFeedResponseDto {
  items: TransactionListItemDto[];
  nextCursor: string | null;
  hasMore: boolean;
}

// ============================================================
// Cursor Encoding/Decoding
// ============================================================

export interface TransactionCursor {
  t: string; // occurredAt ISO string
  id: number;
}

/**
 * Encode cursor to base64 string
 */
export function encodeCursor(occurredAt: Date, id: number): string {
  const cursor: TransactionCursor = {
    t: occurredAt.toISOString(),
    id,
  };
  return Buffer.from(JSON.stringify(cursor)).toString('base64');
}

/**
 * Decode cursor from base64 string
 * Returns null if invalid
 */
export function decodeCursor(cursor: string): TransactionCursor | null {
  try {
    const json = Buffer.from(cursor, 'base64').toString('utf-8');
    const parsed = JSON.parse(json);
    if (typeof parsed.t === 'string' && typeof parsed.id === 'number') {
      return parsed as TransactionCursor;
    }
    return null;
  } catch {
    return null;
  }
}
