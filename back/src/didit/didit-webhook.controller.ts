import {
  Controller,
  Post,
  Body,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  BadRequestException,
  Req,
} from '@nestjs/common';
import { DiditService } from './didit.service';
import type { DiditWebhookPayload } from './didit.service';
import { MailService } from '../mail/mail.service';
import { S3Service } from '../home/services/s3.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';

@Controller('webhooks')
export class DiditWebhookController {
  private readonly logger = new Logger(DiditWebhookController.name);

  constructor(
    private readonly diditService: DiditService,
    private readonly mailService: MailService,
    private readonly s3Service: S3Service,
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * POST /webhooks/didit
   *
   * Receives and processes Didit verification webhooks.
   *
   * Events handled:
   * - Approved: User verified successfully
   * - Declined/Rejected: Verification failed
   * - Need Review: Manual review required
   * - Expired/Abandoned: Session timeout
   */
  @Post('didit')
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Body() body: any,
    @Headers('x-signature') signature: string,
    @Headers('x-didit-signature') diditSignature: string,
    @Req() req: any,
  ) {
    // EXHAUSTIVE LOGGING - Log raw body for debugging as requested
    const rawBody = req.rawBody
      ? typeof req.rawBody === 'string'
        ? req.rawBody
        : req.rawBody.toString()
      : JSON.stringify(body);
    this.logger.log(`[DIDIT RAW WEBHOOK] Payload: ${rawBody}`);

    // Verify signature (use either header that Didit sends)
    const signatureHeader = signature || diditSignature;

    if (signatureHeader) {
      const isValid = this.diditService.verifyWebhookSignature(
        rawBody,
        signatureHeader,
      );

      if (!isValid) {
        this.logger.error('Didit webhook signature verification failed');
        throw new BadRequestException('Invalid webhook signature');
      }
    }

    try {
      // Process the webhook event
      await this.diditService.handleWebhookEvent(body);

      // Send email notifications based on status
      await this.sendNotifications(body);

      // Log to S3 for audit trail
      await this.logToS3(body);

      return { received: true };
    } catch (error) {
      this.logger.error(
        `Error processing Didit webhook: ${error.message}`,
        error.stack,
      );
      // Return 200 to prevent retries for processing errors
      return { received: true, error: 'Processing error' };
    }
  }

  /**
   * Send email notifications based on verification status
   */
  private async sendNotifications(payload: DiditWebhookPayload): Promise<void> {
    const userId = payload.vendor_data
      ? parseInt(payload.vendor_data, 10)
      : null;
    if (!userId) return;

    // Fetch user with updated KYC status and reason
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { mail: true, firstName: true, kycStatus: true, kycReason: true },
    });

    if (!user) return;

    switch (payload.status) {
      case 'Approved':
        // Send verification success email ONLY if the final status in DB is VERIFIED
        // (handleApproved might have rejected it for age/name mismatch)
        if (user.kycStatus === 'VERIFIED') {
          try {
            await this.mailService.sendIdentityVerifiedEmail(
              user.mail,
              user.firstName,
            );
          } catch (e) {
            this.logger.error(
              `Failed to send verification success email: ${e.message}`,
            );
          }
        } else if (user.kycStatus === 'REJECTED') {
          // It was approved by Didit but rejected by our local logic
          try {
            const message = this.convertKycReasonToFrench(user.kycReason);
            await this.mailService.sendIdentityVerificationRetryEmail(
              user.mail,
              user.firstName,
              message,
            );
          } catch (e) {
            this.logger.error(
              `Failed to send verification retry email (local rejection): ${e.message}`,
            );
          }
        }
        break;

      case 'Declined':
      case 'Rejected':
        // Check if user has switched to MANUAL_REVIEW
        if (user.kycStatus === ('MANUAL_REVIEW' as any)) {
          try {
            await this.mailService.sendIdentityVerificationManualReviewEmail(
              user.mail,
              user.firstName,
            );
          } catch (e) {
            this.logger.error(
              `Failed to send manual review email: ${e.message}`,
            );
          }
        } else {
          // Send verification retry email with reason from DB
          try {
            const message = this.convertKycReasonToFrench(user.kycReason);
            await this.mailService.sendIdentityVerificationRetryEmail(
              user.mail,
              user.firstName,
              message,
            );
          } catch (e) {
            this.logger.error(
              `Failed to send verification retry email: ${e.message}`,
            );
          }
        }
        break;
    }

    // Monitoring Alert: Notification email to supervisor for ANY non-Approved status
    // Role: Alerting Admin
    if (payload.status !== 'Approved') {
      const monitoringEmail = this.configService.get<string>(
        'KYC_MONITORING_EMAIL',
        'admin@reloke.com',
      );
      const alertData = {
        sessionId: payload.session_id,
        status: payload.status,
        userId: userId,
        userEmail: user.mail,
        userName: `${user.firstName}`,
        rejectionReason:
          payload.rejection_reason ||
          (payload.decline_reasons && payload.decline_reasons.join(', ')),
        timestamp: new Date().toISOString(),
      };

      try {
        // We use a generic security alert email for now or we could add a specific method to MailService
        await this.mailService.sendAdminSecurityAlert(
          [monitoringEmail],
          'warning',
          `Alerte KYC : Session ${payload.status}`,
          alertData,
        );
      } catch (e) {
        this.logger.error(
          `Failed to send KYC monitoring alert to ${monitoringEmail}: ${e.message}`,
        );
      }
    }
  }

  /**
   * Converts raw KYC codes to French user-friendly message
   */
  private convertKycReasonToFrench(rawReason: string | null): string {
    this.logger.log(
      `[convertKycReasonToFrench] Raw reason to translate: "${rawReason}"`,
    );

    if (!rawReason) return 'Votre vérification a échoué. Veuillez réessayer.';

    const reasons = rawReason.split('|');
    const translated: string[] = [];

    reasons.forEach((part) => {
      const trimmedPart = part.trim();
      // Using startsWith for all allows future extensibility and consistency
      if (trimmedPart.startsWith('MINIMUM_AGE_NOT_MET')) {
        const limit = trimmedPart.split(':')[1];
        translated.push(
          `Vous devez avoir au moins ${limit || '18'} ans pour utiliser notre service.`,
        );
      } else if (trimmedPart.startsWith('POSSIBLE_DUPLICATED_USER')) {
        translated.push('Un compte vérifié existe déjà avec ces informations.');
      } else if (trimmedPart.startsWith('DOC_EXPIRED')) {
        translated.push("Votre document d'identité a expiré.");
      } else if (trimmedPart.startsWith('POOR_QUALITY')) {
        translated.push("La qualité de l'image est insuffisante.");
      } else if (trimmedPart.startsWith('NO_FACE_DETECTED')) {
        translated.push(
          "Aucun visage détecté. Assurez-vous d'être bien face caméra et sans accessoire masquant le visage.",
        );
      } else if (trimmedPart.startsWith('LOW_FACE_MATCH_SIMILARITY')) {
        translated.push(
          'Votre visage ne correspond pas suffisamment à la photo du document.',
        );
      } else if (trimmedPart.startsWith('VERIFICATION_FAILED')) {
        translated.push('Vérification échouée.');
      } else {
        // Fallback for unknown codes
        // Validation: If it looks like a code (no spaces, uppercase), show generic message
        // If it looks like a sentence (has spaces), passing it might be risky if it contains English,
        // but usually rawReason from our Service now contains codes or explicit sentences.
        // To be safe and strictly follow "no codes", if it looks like a SCREAMING_SNAKE_CASE code, we hide it.
        const isCodeLike = /^[A-Z0-9_]+(:[A-Z0-9_]+)?$/.test(trimmedPart);

        if (isCodeLike) {
          this.logger.warn(
            `[convertKycReasonToFrench] Unknown code hidden from user: ${trimmedPart}`,
          );
          translated.push(
            'Vérification échouée. Veuillez vérifier les documents fournis et assurez vous de la clarté des photos prises.',
          );
        } else {
          // It's likely a sentence we constructed or a raw sentence from Didit that isn't a code.
          // We accept it, but log it.
          translated.push(trimmedPart);
        }
      }
    });

    // Join distinct messages (deduplicate just in case)
    return [...new Set(translated)].join(' ');
  }

  /**
   * Log webhook events to S3 for audit trail
   */
  private async logToS3(payload: DiditWebhookPayload): Promise<void> {
    const userId = payload.vendor_data
      ? parseInt(payload.vendor_data, 10)
      : 'unknown';

    try {
      const logData = {
        sessionId: payload.session_id,
        userId,
        status: payload.status,
        liveness: payload.liveness,
        faceMatch: payload.face_match,
        declineReasons: payload.decline_reasons,
        timestamp: new Date().toISOString(),
      };

      const logKey = `kyc-logs/didit/${userId}_${payload.session_id}_${Date.now()}.json`;

      await this.s3Service.uploadFile(
        Buffer.from(JSON.stringify(logData, null, 2)),
        logKey,
        'application/json',
      );
    } catch (e) {
      this.logger.error(`Failed to log to S3: ${e.message}`);
      // Non-blocking - don't throw
    }
  }
}
