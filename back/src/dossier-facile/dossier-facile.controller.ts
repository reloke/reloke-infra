import {
  Controller,
  Post,
  Body,
  UseGuards,
  Req,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { DossierFacileService } from './dossier-facile.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('dossier-facile')
@UseGuards(JwtAuthGuard)
export class DossierFacileController {
  private readonly logger = new Logger(DossierFacileController.name);

  constructor(private readonly dossierFacileService: DossierFacileService) {}

  @Post('update-url')
  async updateUrl(@Req() req, @Body('url') url: string) {
    const userId = req.user?.userId;
    this.logger.log(
      `[POST /update-url] Request from user ${userId} with URL: ${url}`,
    );

    if (!userId) {
      this.logger.error('[POST /update-url] No userId in request user object');
      throw new HttpException(
        'Utilisateur non authentifié',
        HttpStatus.UNAUTHORIZED,
      );
    }

    try {
      const result = await this.dossierFacileService.updateDossierUrl(
        userId,
        url,
      );
      this.logger.log(`[POST /update-url] SUCCESS for user ${userId}`);
      return result;
    } catch (error) {
      const errorMsg = error.message || 'Erreur lors de la mise à jour du lien';
      this.logger.error(
        `[POST /update-url] FAILED for user ${userId}: ${errorMsg}`,
      );
      throw new HttpException(errorMsg, HttpStatus.BAD_REQUEST);
    }
  }

  @Post('validate-url')
  async validateUrl(@Body('url') url: string) {
    this.logger.log(`[POST /validate-url] Validating: ${url}`);
    return this.dossierFacileService.validateUrl(url);
  }
}
