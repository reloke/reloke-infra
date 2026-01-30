import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  ParseIntPipe,
  BadRequestException,
  Req,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Role } from '../auth/enums/role.enum';
import { AdminUserService } from './admin-user.service';
import { AdminAuditService } from './admin-audit.service';
import { AdminAuditAction } from '@prisma/client';

// Security - Rate Limiting
import { AdminRateLimitGuard } from './security/admin-rate-limit.guard';
import { AdminRateLimit } from './security/admin-rate-limit.decorator';
import { RateLimitCategory } from './security/admin-rate-limit.constants';

// UUID v4 regex for validation
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Controller('admin/users')
@UseGuards(AuthGuard('jwt'), RolesGuard, AdminRateLimitGuard)
@Roles(Role.ADMIN)
export class AdminUserController {
  constructor(
    private readonly adminUserService: AdminUserService,
    private readonly adminAuditService: AdminAuditService,
  ) {}

  /**
   * GET /admin/users/by-uid/:uid/context
   * Get full user context for admin view using secure UID
   * Rate limited: HEAVY_READ category (10 req/min)
   */
  @Get('by-uid/:uid/context')
  @AdminRateLimit({ category: RateLimitCategory.HEAVY_READ })
  async getUserContextByUid(@Param('uid') uid: string, @Req() request: any) {
    // Validate UUID format to prevent injection attacks
    if (!UUID_REGEX.test(uid)) {
      throw new BadRequestException('Invalid user identifier format');
    }

    const context = await this.adminUserService.getUserFullContextByUid(uid);

    // Log this admin action
    const admin = request.user as { userId: number; mail: string };
    await this.adminAuditService.log({
      adminId: admin.userId,
      adminEmail: admin.mail,
      action: AdminAuditAction.VIEW_USER_CONTEXT,
      targetUserId: context.user.id,
      targetUserUid: uid,
      request,
    });

    return context;
  }

  /**
   * GET /admin/users/by-uid/:uid/transactions
   * Get paginated transactions for a user
   * Supports both page-based (desktop) and cursor-based (mobile) pagination
   * Rate limited: LIST_READ category (30 req/min)
   */
  @Get('by-uid/:uid/transactions')
  @AdminRateLimit({ category: RateLimitCategory.LIST_READ })
  async getUserTransactions(
    @Param('uid') uid: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
    @Req() request?: any,
  ) {
    // Validate UUID format
    if (!UUID_REGEX.test(uid)) {
      throw new BadRequestException('Invalid user identifier format');
    }

    const pageNum = page ? parseInt(page, 10) : undefined;
    const limitNum = limit ? parseInt(limit, 10) : 10;

    // Validate limit
    if (limitNum < 1 || limitNum > 50) {
      throw new BadRequestException('Limit must be between 1 and 50');
    }

    const result = await this.adminUserService.getUserTransactionsPaginated(
      uid,
      pageNum,
      limitNum,
      cursor,
    );

    // Log this admin action
    if (request?.user) {
      const admin = request.user as { userId: number; mail: string };
      await this.adminAuditService.log({
        adminId: admin.userId,
        adminEmail: admin.mail,
        action: AdminAuditAction.VIEW_TRANSACTION,
        targetUserUid: uid,
        metadata: { page: pageNum, cursor },
        request,
      });
    }

    return result;
  }

  /**
   * GET /admin/transactions/:transactionId
   * Get detailed transaction info including payment details and Stripe metadata
   * Rate limited: LIGHT_READ category (100 req/min)
   */
  @Get('/transactions/:transactionId')
  @AdminRateLimit({ category: RateLimitCategory.LIGHT_READ })
  async getTransactionDetail(
    @Param('transactionId', ParseIntPipe) transactionId: number,
    @Req() request: any,
  ) {
    const result =
      await this.adminUserService.getTransactionDetail(transactionId);

    // Log this admin action
    const admin = request.user as { userId: number; mail: string };
    await this.adminAuditService.log({
      adminId: admin.userId,
      adminEmail: admin.mail,
      action: AdminAuditAction.VIEW_TRANSACTION,
      targetUserId: result.userId,
      metadata: { transactionId },
      request,
    });

    return result;
  }

  /**
   * GET /admin/users/by-uid/:uid/matches
   * Get paginated matches for a user
   * Supports both page-based (desktop) and cursor-based (mobile) pagination
   * Rate limited: LIST_READ category (30 req/min)
   */
  @Get('by-uid/:uid/matches')
  @AdminRateLimit({ category: RateLimitCategory.LIST_READ })
  async getUserMatches(
    @Param('uid') uid: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
    @Req() request?: any,
  ) {
    // Validate UUID format
    if (!UUID_REGEX.test(uid)) {
      throw new BadRequestException('Invalid user identifier format');
    }

    const pageNum = page ? parseInt(page, 10) : undefined;
    const limitNum = limit ? parseInt(limit, 10) : 10;

    // Validate limit
    if (limitNum < 1 || limitNum > 50) {
      throw new BadRequestException('Limit must be between 1 and 50');
    }

    const result = await this.adminUserService.getUserMatchesPaginated(
      uid,
      pageNum,
      limitNum,
      cursor,
    );

    // Log this admin action
    if (request?.user) {
      const admin = request.user as { userId: number; mail: string };
      await this.adminAuditService.log({
        adminId: admin.userId,
        adminEmail: admin.mail,
        action: AdminAuditAction.VIEW_USER_CONTEXT,
        targetUserUid: uid,
        metadata: { page: pageNum, cursor, type: 'matches' },
        request,
      });
    }

    return result;
  }

  /**
   * GET /admin/users/matches/:matchUid
   * Get detailed match info including users, homes, and snapshot data
   * Rate limited: LIGHT_READ category (100 req/min)
   */
  @Get('/matches/:matchUid')
  @AdminRateLimit({ category: RateLimitCategory.LIGHT_READ })
  async getMatchDetail(
    @Param('matchUid') matchUid: string,
    @Req() request: any,
  ) {
    // Validate UUID format
    if (!UUID_REGEX.test(matchUid)) {
      throw new BadRequestException('Invalid match identifier format');
    }

    const result = await this.adminUserService.getMatchDetail(matchUid);

    // Log this admin action
    const admin = request.user as { userId: number; mail: string };
    await this.adminAuditService.log({
      adminId: admin.userId,
      adminEmail: admin.mail,
      action: AdminAuditAction.VIEW_USER_CONTEXT,
      targetUserId: result.seekerUser.id,
      metadata: { matchUid, matchType: result.type },
      request,
    });

    return result;
  }

  // ============================================
  // DEPRECATED ENDPOINTS - Keep for backwards compatibility
  // These will be removed in a future version
  // ============================================

  /**
   * @deprecated Use GET /admin/users/by-uid/:uid/context instead
   * GET /admin/users/:userId/context
   * Get full user context for admin view (DEPRECATED - uses integer ID)
   * Rate limited: HEAVY_READ category (10 req/min)
   */
  @Get(':userId/context')
  @AdminRateLimit({ category: RateLimitCategory.HEAVY_READ })
  async getUserContext(
    @Param('userId', ParseIntPipe) userId: number,
    @Req() request: any,
  ) {
    const context = await this.adminUserService.getUserFullContext(userId);

    // Log this admin action
    const admin = request.user as { userId: number; mail: string };
    await this.adminAuditService.log({
      adminId: admin.userId,
      adminEmail: admin.mail,
      action: AdminAuditAction.VIEW_USER_CONTEXT,
      targetUserId: userId,
      metadata: {
        deprecated: true,
        message: 'Using deprecated integer ID endpoint',
      },
      request,
    });

    return context;
  }
}
