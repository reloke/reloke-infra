import {
  Controller,
  Post,
  Get,
  Req,
  UseGuards,
  HttpException,
  HttpStatus,
  Logger,
  Body,
} from '@nestjs/common';
import { DataLifecycleService } from './services/data-lifecycle.service';
import { ExportService } from './services/export.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('v1/me')
@UseGuards(JwtAuthGuard)
export class GdprController {
  private readonly logger = new Logger(GdprController.name);

  constructor(
    private readonly lifecycleService: DataLifecycleService,
    private readonly exportService: ExportService,
  ) {}

  @Get('data-export')
  async exportData(@Req() req) {
    if (!req.user || !req.user.userId) {
      throw new HttpException(
        'User not authenticated',
        HttpStatus.UNAUTHORIZED,
      );
    }
    return this.exportService.exportUserData(req.user.userId);
  }

  @Post('delete-account')
  async requestDeletion(@Req() req) {
    const result = await this.lifecycleService.scheduleAccountDeletion(
      req.user.userId,
    );

    return {
      message: result.isLegalHold
        ? 'Votre compte a été désactivé. La suppression complète sera effectuée après clôture du dossier en cours.'
        : 'Votre demande de suppression a été prise en compte. Votre compte sera supprimé définitivement dans 30 jours.',
      scheduledAt: result.scheduledAt,
      legalHold: result.isLegalHold,
      refundApplied: result.refundApplied,
      refundAmount: result.refundAmount,
      matchesRefunded: result.matchesRefunded,
    };
  }

  @Post('cancel-delete-account')
  async cancelDeletion(@Req() req) {
    await this.lifecycleService.cancelAccountDeletion(req.user.userId);
    return { message: 'Votre demande de suppression a été annulée.' };
  }

  @Post('activity')
  async touchActivity(@Req() req) {
    await this.lifecycleService.touchUserActivity(req.user.userId);
    return { received: true };
  }
}
