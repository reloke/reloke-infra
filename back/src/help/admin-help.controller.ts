import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Role } from '../auth/enums/role.enum';
import { AdminHelpService } from './admin-help.service';
import {
  HelpRequestDto,
  PaginatedHelpRequestsDto,
} from './dto/help-request.dto';
import {
  ResolveHelpRequestDto,
  UserFullContextDto,
} from './dto/admin-help.dto';
import { HelpRequestStatus } from '@prisma/client';

// Security - Rate Limiting
import { AdminRateLimitGuard } from '../admin/security/admin-rate-limit.guard';
import { AdminRateLimit } from '../admin/security/admin-rate-limit.decorator';
import { RateLimitCategory } from '../admin/security/admin-rate-limit.constants';

@Controller('admin/help')
@UseGuards(AuthGuard('jwt'), RolesGuard, AdminRateLimitGuard)
@Roles(Role.ADMIN)
export class AdminHelpController {
  constructor(private readonly adminHelpService: AdminHelpService) {}

  /**
   * GET /admin/help/requests
   * List all help requests with optional status filter and pagination
   */
  @Get('requests')
  @AdminRateLimit({ category: RateLimitCategory.LIST_READ })
  async listHelpRequests(
    @Query('status') status?: HelpRequestStatus,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ): Promise<PaginatedHelpRequestsDto> {
    const parsedLimit = limit ? parseInt(limit, 10) : undefined;
    return this.adminHelpService.listHelpRequests(status, cursor, parsedLimit);
  }

  /**
   * GET /admin/help/stats
   * Get help request statistics
   */
  @Get('stats')
  @AdminRateLimit({ category: RateLimitCategory.HEAVY_READ })
  async getStats(): Promise<{
    open: number;
    inProgress: number;
    resolvedToday: number;
  }> {
    return this.adminHelpService.getStats();
  }

  /**
   * GET /admin/help/requests/:uid
   * Get help request details
   */
  @Get('requests/:uid')
  @AdminRateLimit({ category: RateLimitCategory.LIGHT_READ })
  async getHelpRequest(@Param('uid') uid: string): Promise<HelpRequestDto> {
    return this.adminHelpService.getHelpRequest(uid);
  }

  /**
   * GET /admin/help/requests/:uid/context
   * Get full user context for a help request
   */
  @Get('requests/:uid/context')
  @AdminRateLimit({ category: RateLimitCategory.HEAVY_READ })
  async getUserContext(@Param('uid') uid: string): Promise<UserFullContextDto> {
    return this.adminHelpService.getUserContext(uid);
  }

  /**
   * POST /admin/help/requests/:uid/claim
   * Claim a help request
   */
  @Post('requests/:uid/claim')
  @AdminRateLimit({ category: RateLimitCategory.ACTION })
  async claimHelpRequest(
    @Request() req,
    @Param('uid') uid: string,
  ): Promise<HelpRequestDto> {
    return this.adminHelpService.claimHelpRequest(uid, req.user.userId);
  }

  /**
   * POST /admin/help/requests/:uid/release
   * Release a claimed help request
   */
  @Post('requests/:uid/release')
  @AdminRateLimit({ category: RateLimitCategory.ACTION })
  async releaseHelpRequest(
    @Request() req,
    @Param('uid') uid: string,
  ): Promise<HelpRequestDto> {
    return this.adminHelpService.releaseHelpRequest(uid, req.user.userId);
  }

  /**
   * POST /admin/help/requests/:uid/resolve
   * Resolve a help request
   */
  @Post('requests/:uid/resolve')
  @AdminRateLimit({ category: RateLimitCategory.ACTION })
  async resolveHelpRequest(
    @Request() req,
    @Param('uid') uid: string,
    @Body() dto: ResolveHelpRequestDto,
  ): Promise<HelpRequestDto> {
    return this.adminHelpService.resolveHelpRequest(uid, req.user.userId, dto);
  }
}
