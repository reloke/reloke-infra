import {
  Controller,
  Get,
  Post,
  Put,
  Param,
  UseGuards,
  ParseIntPipe,
  Query,
  Body,
  Req,
} from '@nestjs/common';
import { AdminService } from './admin.service';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Role } from '../auth/enums/role.enum';

// Security - Rate Limiting
import { AdminRateLimitGuard } from './security/admin-rate-limit.guard';
import { AdminRateLimit } from './security/admin-rate-limit.decorator';
import { RateLimitCategory } from './security/admin-rate-limit.constants';

@Controller('admin')
@UseGuards(AuthGuard('jwt'), RolesGuard, AdminRateLimitGuard)
@Roles(Role.ADMIN)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('stats')
  @AdminRateLimit({ category: RateLimitCategory.HEAVY_READ })
  getStats() {
    return this.adminService.getDashboardStats();
  }

  @Get('users')
  @AdminRateLimit({ category: RateLimitCategory.LIST_READ })
  getUsers(
    @Query('search') search?: string,
    @Query('role') role?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    const pageNum = page ? parseInt(page, 10) : undefined;
    const limitNum = limit ? parseInt(limit, 10) : 20;
    return this.adminService.findAllUsers(
      search,
      role,
      status,
      pageNum,
      limitNum,
      cursor,
    );
  }

  @Get('users/:id/logs')
  @AdminRateLimit({ category: RateLimitCategory.LIST_READ })
  getUserLogs(@Param('id', ParseIntPipe) id: number) {
    return this.adminService.getUserLogs(id);
  }

  @Post('users/:id/ban')
  @AdminRateLimit({ category: RateLimitCategory.ACTION })
  banUser(
    @Param('id', ParseIntPipe) id: number,
    @Body()
    body: { reason?: string; customMessage?: string; template?: string },
  ) {
    return this.adminService.banUser(id, body);
  }

  @Post('users/:id/unban')
  @AdminRateLimit({ category: RateLimitCategory.ACTION })
  unbanUser(@Param('id', ParseIntPipe) id: number) {
    return this.adminService.unbanUser(id);
  }

  @Post('users/:id/verify')
  @AdminRateLimit({ category: RateLimitCategory.ACTION })
  verifyUser(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { approved: boolean; reason?: string },
  ) {
    console.log(
      `[AdminController] verifyUser called for id: ${id}, approved: ${body.approved}`,
    );
    return this.adminService.verifyUser(id, body.approved, body.reason);
  }

  @Post('users/:id/refund')
  @AdminRateLimit({ category: RateLimitCategory.ACTION })
  refundUser(@Param('id', ParseIntPipe) id: number) {
    return this.adminService.refundUser(id);
  }

  // --- Influencers & Promos ---

  @Get('influencers')
  @AdminRateLimit({ category: RateLimitCategory.LIST_READ })
  getInfluencers() {
    return this.adminService.findAllInfluencers();
  }

  @Post('influencers')
  @AdminRateLimit({ category: RateLimitCategory.ACTION })
  createInfluencer(
    @Body() body: { firstName: string; lastName: string; email: string },
  ) {
    return this.adminService.createInfluencer(body);
  }

  @Get('influencers/:id/impact')
  @AdminRateLimit({ category: RateLimitCategory.LIGHT_READ })
  getInfluencerDeletionImpact(@Param('id', ParseIntPipe) id: number) {
    return this.adminService.getInfluencerDeletionImpact(id);
  }

  @Post('influencers/:id/delete')
  @AdminRateLimit({ category: RateLimitCategory.ACTION })
  deleteInfluencer(@Param('id', ParseIntPipe) id: number) {
    return this.adminService.deleteInfluencer(id);
  }

  @Post('influencers/:id/report')
  @AdminRateLimit({ category: RateLimitCategory.ACTION })
  sendInfluencerReport(@Param('id', ParseIntPipe) id: number) {
    return this.adminService.sendInfluencerReport(id);
  }

  @Get('promos')
  @AdminRateLimit({ category: RateLimitCategory.LIST_READ })
  getPromos() {
    return this.adminService.findAllPromoCodes();
  }

  @Post('promos')
  @AdminRateLimit({ category: RateLimitCategory.ACTION })
  createPromo(
    @Body()
    body: {
      code: string;
      discountPercentage: number;
      validUntil: string;
      usageLimit?: number;
      influencerId: number;
    },
  ) {
    return this.adminService.createPromoCode(body);
  }

  @Post('promos/:id/delete')
  @AdminRateLimit({ category: RateLimitCategory.ACTION })
  deletePromo(@Param('id', ParseIntPipe) id: number) {
    return this.adminService.deletePromoCode(id);
  }

  @Put('influencers/:id')
  @AdminRateLimit({ category: RateLimitCategory.ACTION })
  updateInfluencer(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.adminService.updateInfluencer(id, body);
  }

  @Put('promos/:id')
  @AdminRateLimit({ category: RateLimitCategory.ACTION })
  updatePromo(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.adminService.updatePromoCode(id, body);
  }

  @Post('promos/:id/toggle')
  @AdminRateLimit({ category: RateLimitCategory.ACTION })
  togglePromo(@Param('id', ParseIntPipe) id: number) {
    return this.adminService.togglePromoCode(id);
  }

  // --- Reports & Moderation ---

  @Get('reports')
  @AdminRateLimit({ category: RateLimitCategory.LIST_READ })
  getReports(@Query('showArchived') showArchived: string) {
    return this.adminService.findAllReports(showArchived === 'true');
  }

  @Post('reports/:id/archive')
  @AdminRateLimit({ category: RateLimitCategory.ACTION })
  archiveReport(@Param('id', ParseIntPipe) id: number) {
    return this.adminService.archiveReport(id);
  }

  @Get('chats/:id/thread')
  @AdminRateLimit({ category: RateLimitCategory.LIST_READ })
  getChatThread(@Param('id', ParseIntPipe) id: number) {
    return this.adminService.getChatThread(id);
  }

  // --- KYC Verifications ---

  @Get('verifications')
  @AdminRateLimit({ category: RateLimitCategory.LIST_READ })
  getKycVerifications(
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 20;
    return this.adminService.findKycVerifications(
      search,
      status,
      pageNum,
      limitNum,
    );
  }

  @Post('verifications/:id/clarify')
  @AdminRateLimit({ category: RateLimitCategory.ACTION })
  sendKycClarification(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { reason: string },
  ) {
    return this.adminService.sendKycClarification(id, body.reason);
  }

  @Post('users/:id/reset-kyc')
  @AdminRateLimit({ category: RateLimitCategory.ACTION })
  resetUserKyc(
    @Param('id', ParseIntPipe) userId: number,
    @Req() req: any, // Access user from request to get admin ID
  ) {
    // req.user is populated by AuthGuard ('jwt')
    const adminId = req.user.id;
    return this.adminService.resetUserKyc(userId, adminId);
  }

  @Get('logs')
  @AdminRateLimit({ category: RateLimitCategory.LIST_READ })
  getAuditLogs(@Query('page') page?: string, @Query('limit') limit?: string) {
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 20;
    return this.adminService.getAuditLogs(pageNum, limitNum);
  }

  // --- Financial Statistics ---

  /**
   * GET /admin/financial/stats
   * Get comprehensive financial statistics
   * Rate limited: HEAVY_READ category (60 req/min)
   */
  @Get('financial/stats')
  @AdminRateLimit({ category: RateLimitCategory.HEAVY_READ })
  getFinancialStats() {
    return this.adminService.getFinancialStats();
  }

  /**
   * GET /admin/financial/timeseries
   * Get time series data for charts (matches used/refunded)
   * Query params:
   *   - period: 'day' | 'week' | 'month' | 'year'
   *   - startDate: ISO date string (optional)
   *   - endDate: ISO date string (optional)
   * Rate limited: LIST_READ category (30 req/min)
   */
  @Get('financial/timeseries')
  @AdminRateLimit({ category: RateLimitCategory.LIST_READ })
  getFinancialTimeSeries(
    @Query('period') period: string = 'day',
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const start = startDate ? new Date(startDate) : undefined;
    const end = endDate ? new Date(endDate) : undefined;
    return this.adminService.getFinancialTimeSeries(
      period as 'day' | 'week' | 'month' | 'year',
      start,
      end,
    );
  }
}
