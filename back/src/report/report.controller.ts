import { Controller, Post, Body, UseGuards, Req } from '@nestjs/common';
import { ReportService } from './report.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('report')
@UseGuards(JwtAuthGuard)
export class ReportController {
  constructor(private readonly reportService: ReportService) {}

  @Post()
  async createReport(
    @Req() req,
    @Body()
    data: {
      reportedUserId: number;
      chatId: number;
      reason?: string;
      description?: string;
    },
  ) {
    const reporterId = req.user.userId;
    return this.reportService.createReport(reporterId, data);
  }
}
