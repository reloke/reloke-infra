import {
  Controller,
  Get,
  UseGuards,
  Req,
  Res,
  Param,
  ForbiddenException,
  Query,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OwnershipGuard } from '../auth/guards/ownership.guard';
import { ProfileExportService } from './services/profile-export.service';
import type { Response } from 'express';

@Controller('profile')
@UseGuards(JwtAuthGuard)
export class ProfileController {
  constructor(private readonly exportService: ProfileExportService) {}

  @Get(['export', 'export/:userId'])
  @UseGuards(JwtAuthGuard, OwnershipGuard)
  async exportData(
    @Param('userId') targetUserId: string,
    @Req() req: any,
    @Res() res: Response,
    @Query('format') format: string = 'xlsx',
  ) {
    const userIdToExport = targetUserId
      ? Number(targetUserId)
      : req.user.userId;
    return this.exportService.exportUserData(userIdToExport, res, format);
  }
}
