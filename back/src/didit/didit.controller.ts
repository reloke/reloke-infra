import {
  Controller,
  Post,
  Get,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { DiditService } from './didit.service';
import { UserService } from '../user/user.service';

@Controller('kyc')
export class DiditController {
  private readonly logger = new Logger(DiditController.name);

  constructor(
    private readonly diditService: DiditService,
    private readonly userService: UserService,
  ) {}

  /**
   * POST /kyc/create-session
   *
   * Creates a new Didit verification session for the authenticated user.
   * Returns the verification URL to redirect the user to.
   */
  @Post('create-session')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async createSession(@Req() req: any) {
    const userId = req.user.userId;
    const user = await this.userService.findOne(userId);

    if (!user) {
      throw new BadRequestException('Utilisateur non trouvé');
    }

    if (!user.firstName || !user.lastName) {
      throw new BadRequestException(
        "Veuillez compléter votre nom et prénom avant de lancer la vérification d'identité",
      );
    }

    if (user.isKycVerified) {
      throw new BadRequestException('Votre identité est déjà vérifiée');
    }

    if (!this.diditService.isConfigured()) {
      throw new BadRequestException(
        "Le service de vérification d'identité n'est pas configuré",
      );
    }

    try {
      const session = await this.diditService.createVerificationSession(
        userId,
        user.firstName,
        user.lastName,
      );

      return {
        success: true,
        sessionId: session.sessionId,
        verificationUrl: session.verificationUrl,
      };
    } catch (error) {
      this.logger.error(
        `Failed to create session for user ${userId}: ${error.message}`,
      );
      throw new BadRequestException(
        'Impossible de créer la session de vérification. Veuillez réessayer.',
      );
    }
  }

  /**
   * GET /kyc/status
   *
   * Returns the current KYC status for the authenticated user.
   */
  @Get('status')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async getStatus(@Req() req: any) {
    const userId = req.user.userId;
    const status = await this.diditService.getUserKycStatus(userId);

    if (!status) {
      throw new BadRequestException('Utilisateur non trouvé');
    }

    return {
      kycStatus: status.kycStatus,
      kycReason: status.kycReason,
      isVerified: status.isKycVerified,
      verifiedAt: status.accountValidatedAt,
    };
  }

  /**
   * GET /kyc/session/:sessionId
   *
   * Returns the details of a specific session (for debugging/admin).
   */
  @Get('session/:sessionId')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async getSessionDetails(@Req() req: any) {
    const sessionId = req.params.sessionId;
    const userId = req.user.userId;

    // Verify the session belongs to this user
    const user = await this.userService.findOne(userId);
    if (!user || user.diditSessionId !== sessionId) {
      throw new BadRequestException('Session non trouvée');
    }

    try {
      const details = await this.diditService.getSessionDetails(sessionId);
      return {
        status: details.status,
        createdAt: details.created_at,
        updatedAt: details.updated_at,
      };
    } catch (error) {
      throw new BadRequestException(
        'Impossible de récupérer les détails de la session',
      );
    }
  }
}
