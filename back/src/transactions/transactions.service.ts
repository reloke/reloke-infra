import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  TransactionListItemDto,
  TransactionTableResponseDto,
  TransactionFeedResponseDto,
  TransactionCursor,
  encodeCursor,
  decodeCursor,
} from './transactions.dto';

@Injectable()
export class TransactionsService {
  private readonly logger = new Logger(TransactionsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Get transactions for desktop table (page-based pagination)
   * Uses composite index: (userId, occurredAt DESC, id DESC)
   */
  async getTransactionsTable(
    userId: number,
    page: number,
    pageSize: number,
  ): Promise<TransactionTableResponseDto> {
    const skip = (page - 1) * pageSize;

    // Parallel fetch: items + count
    const [transactions, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where: { userId },
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        skip,
        take: pageSize,
        select: {
          id: true,
          occurredAt: true,
          type: true,
          status: true,
          amountTotal: true,
          currency: true,
          stripeObjectId: true,
          paymentId: true,
        },
      }),
      this.prisma.transaction.count({ where: { userId } }),
    ]);

    const items = transactions.map(this.mapToDto);
    const totalPages = Math.ceil(total / pageSize);

    this.logger.debug(
      `[TransactionsTable] userId=${userId} page=${page} returned=${items.length} total=${total}`,
    );

    return {
      items,
      page,
      pageSize,
      total,
      totalPages,
    };
  }

  /**
   * Get transactions for mobile feed (cursor-based infinite scroll)
   * Cursor is based on (occurredAt, id) for stable ordering
   */
  async getTransactionsFeed(
    userId: number,
    limit: number,
    cursor?: string,
  ): Promise<TransactionFeedResponseDto> {
    let cursorData: TransactionCursor | null = null;

    if (cursor) {
      cursorData = decodeCursor(cursor);
      if (!cursorData) {
        this.logger.warn(`[TransactionsFeed] Invalid cursor: ${cursor}`);
      }
    }

    // Build where clause with cursor logic
    // "Give me items AFTER cursor" means: occurredAt < t OR (occurredAt = t AND id < id)
    const whereClause: any = { userId };

    if (cursorData) {
      const cursorDate = new Date(cursorData.t);
      whereClause.OR = [
        { occurredAt: { lt: cursorDate } },
        {
          AND: [{ occurredAt: cursorDate }, { id: { lt: cursorData.id } }],
        },
      ];
    }

    const transactions = await this.prisma.transaction.findMany({
      where: whereClause,
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: limit,
      select: {
        id: true,
        occurredAt: true,
        type: true,
        status: true,
        amountTotal: true,
        currency: true,
        stripeObjectId: true,
        paymentId: true,
      },
    });

    const items = transactions.map(this.mapToDto);
    const hasMore = items.length === limit;

    // Build next cursor from last item
    let nextCursor: string | null = null;
    if (hasMore && transactions.length > 0) {
      const lastItem = transactions[transactions.length - 1];
      nextCursor = encodeCursor(lastItem.occurredAt, lastItem.id);
    }

    this.logger.debug(
      `[TransactionsFeed] userId=${userId} limit=${limit} returned=${items.length} hasMore=${hasMore}`,
    );

    return {
      items,
      nextCursor,
      hasMore,
    };
  }

  /**
   * Get single transaction details with related payment info.
   * Used for detail modal in frontend.
   *
   * @param userId - Current user ID (security: ensures ownership)
   * @param transactionId - Transaction ID to fetch
   * @returns Transaction with payment details or null if not found/not owned
   */
  async getTransactionDetails(
    userId: number,
    transactionId: number,
  ): Promise<(TransactionListItemDto & { payment: any }) | null> {
    const transaction = await this.prisma.transaction.findFirst({
      where: {
        id: transactionId,
        userId, // Security: ensure user owns this transaction
      },
      include: {
        payment: {
          select: {
            id: true,
            planType: true,
            matchesInitial: true,
            matchesUsed: true,
            matchesRefunded: true,
            amountBase: true,
            amountFees: true,
            amountTotal: true,
            pricePerMatch: true,
            status: true,
            createdAt: true,
            succeededAt: true,
            refundedAt: true,
          },
        },
      },
    });

    if (!transaction) {
      return null;
    }

    return {
      ...this.mapToDto(transaction),
      payment: transaction.payment
        ? {
            id: transaction.payment.id,
            planType: transaction.payment.planType,
            matchesInitial: transaction.payment.matchesInitial,
            matchesUsed: transaction.payment.matchesUsed,
            matchesRefunded: transaction.payment.matchesRefunded ?? 0,
            matchesRemaining:
              transaction.payment.matchesInitial -
              transaction.payment.matchesUsed -
              (transaction.payment.matchesRefunded ?? 0),
            amountBase: transaction.payment.amountBase,
            amountFees: transaction.payment.amountFees,
            amountTotal: transaction.payment.amountTotal,
            pricePerMatch: transaction.payment.pricePerMatch,
            status: transaction.payment.status,
            createdAt: transaction.payment.createdAt.toISOString(),
            succeededAt: transaction.payment.succeededAt?.toISOString() ?? null,
            refundedAt: transaction.payment.refundedAt?.toISOString() ?? null,
          }
        : null,
    };
  }

  /**
   * Map Prisma Transaction to DTO
   */
  private mapToDto(tx: {
    id: number;
    occurredAt: Date;
    type: string;
    status: string;
    amountTotal: number | null;
    currency: string | null;
    stripeObjectId: string | null;
    paymentId: number | null;
  }): TransactionListItemDto {
    return {
      id: tx.id,
      occurredAt: tx.occurredAt.toISOString(),
      type: tx.type,
      status: tx.status,
      amountTotal: tx.amountTotal,
      currency: tx.currency,
      stripeObjectId: tx.stripeObjectId,
      paymentId: tx.paymentId,
    };
  }
}
