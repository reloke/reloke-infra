import {
  Controller,
  Get,
  Query,
  Param,
  ParseIntPipe,
  UseGuards,
  Req,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { TransactionsService } from './transactions.service';
import {
  GetTransactionsTableQueryDto,
  GetTransactionsFeedQueryDto,
  TransactionTableResponseDto,
  TransactionFeedResponseDto,
} from './transactions.dto';

interface AuthenticatedRequest {
  user: { userId: number };
}

/**
 * TransactionsController
 *
 * Endpoints for user transactions history:
 * - GET /transactions/table - Desktop table with page-based pagination
 * - GET /transactions/feed - Mobile feed with cursor-based infinite scroll
 */
@Controller('transactions')
@UseGuards(AuthGuard('jwt'))
export class TransactionsController {
  private readonly logger = new Logger(TransactionsController.name);

  constructor(private readonly transactionsService: TransactionsService) {}

  /**
   * GET /transactions/table
   *
   * Returns paginated transactions for desktop table view.
   * Query params:
   *   - page: page number (default 1)
   *   - pageSize: items per page (default 20, max 100)
   */
  @Get('table')
  async getTransactionsTable(
    @Req() req: AuthenticatedRequest,
    @Query() query: GetTransactionsTableQueryDto,
  ): Promise<TransactionTableResponseDto> {
    const userId = req.user.userId;
    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? 20, 100);

    this.logger.debug(
      `[GET /transactions/table] userId=${userId} page=${page} pageSize=${pageSize}`,
    );

    return this.transactionsService.getTransactionsTable(
      userId,
      page,
      pageSize,
    );
  }

  /**
   * GET /transactions/feed
   *
   * Returns transactions for mobile infinite scroll.
   * Query params:
   *   - limit: items per request (default 20, max 50)
   *   - cursor: opaque cursor for next page (base64 encoded)
   */
  @Get('feed')
  async getTransactionsFeed(
    @Req() req: AuthenticatedRequest,
    @Query() query: GetTransactionsFeedQueryDto,
  ): Promise<TransactionFeedResponseDto> {
    const userId = req.user.userId;
    const limit = Math.min(query.limit ?? 20, 50);
    const cursor = query.cursor;

    this.logger.debug(
      `[GET /transactions/feed] userId=${userId} limit=${limit} cursor=${cursor ? 'present' : 'none'}`,
    );

    return this.transactionsService.getTransactionsFeed(userId, limit, cursor);
  }

  /**
   * GET /transactions/:id
   *
   * Returns single transaction with related payment details.
   * Used for detail modal in frontend.
   */
  @Get(':id')
  async getTransactionDetails(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<any> {
    const userId = req.user.userId;

    this.logger.debug(`[GET /transactions/${id}] userId=${userId}`);

    const details = await this.transactionsService.getTransactionDetails(
      userId,
      id,
    );

    if (!details) {
      throw new NotFoundException('Transaction non trouvée');
    }

    return details;
  }
}
