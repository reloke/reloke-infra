import {
  Controller,
  Post,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
  Logger,
  Headers,
  BadRequestException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { StripeService } from '../stripe/stripe.service';
import { UserService } from '../user/user.service';
import { S3Service } from '../home/services/s3.service';
import { MailService } from '../mail/mail.service';

@Controller('kyc')
export class KycController {
  private readonly logger = new Logger(KycController.name);

  constructor(
    private readonly stripeService: StripeService,
    private readonly userService: UserService,
    private readonly s3Service: S3Service,
    private readonly mailService: MailService,
  ) {}

  @Post('create-session')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async createSession(@Req() req) {
    const userId = req.user.userId;
    const user = await this.userService.findOne(userId);

    if (!user) {
      throw new BadRequestException('Utilisateur non trouvé');
    }

    const session = await this.stripeService.createVerificationSession(
      userId,
      user.mail,
    );

    // Track session in DB
    await this.userService.updateKycStatus(userId, 'PROCESSING', session.id);

    return {
      clientSecret: session.client_secret,
      url: session.url,
    };
  }

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Headers('stripe-signature') signature: string,
    @Req() req: any,
  ) {
    if (!signature) {
      throw new BadRequestException('Missing stripe-signature header');
    }

    let event: any;
    try {
      // Use rawBody for signature verification (enabled in main.ts)
      event = this.stripeService.constructEvent(req.rawBody, signature);
    } catch (err: any) {
      this.logger.error(
        `Webhook signature verification failed: ${err.message}`,
      );
      throw new BadRequestException('Webhook signature verification failed');
    }

    const session = event.data.object;
    const userId = session.metadata?.userId
      ? Number(session.metadata.userId)
      : null;

    if (!userId) {
      this.logger.warn(
        `Webhook received for session ${session.id} without userId in metadata`,
      );
      return { received: true };
    }

    const user = await this.userService.findOne(userId);
    if (!user) {
      this.logger.error(`User ${userId} not found for KYC webhook`);
      return { received: true };
    }

    switch (event.type) {
      case 'identity.verification_session.verified':
        this.logger.log(`KYC verified for user ${userId}`);
        await this.userService.validateIdentity(userId, session.id);

        // S3 Log
        try {
          const logData = {
            sessionId: session.id,
            userId,
            status: 'verified',
            timestamp: new Date().toISOString(),
          };
          const logKey = `kyc-logs/${userId}_${Date.now()}.json`;
          await this.s3Service.uploadFile(
            Buffer.from(JSON.stringify(logData)),
            logKey,
            'application/json',
          );
        } catch (s3Error) {
          this.logger.error(
            `Failed to upload KYC log to S3 for user ${userId}: ${s3Error.message}`,
          );
        }

        // SES Email
        await this.mailService.sendIdentityVerifiedEmail(
          user.mail,
          user.firstName,
        );
        break;

      case 'identity.verification_session.requires_input':
        this.logger.warn(`KYC requires input for user ${userId}`);
        await this.userService.updateKycStatus(
          userId,
          'REQUIRES_INPUT',
          session.id,
        );
        await this.mailService.sendIdentityVerificationRetryEmail(
          user.mail,
          user.firstName,
        );
        break;

      case 'identity.verification_session.processing':
        await this.userService.updateKycStatus(
          userId,
          'PROCESSING',
          session.id,
        );
        break;

      case 'identity.verification_session.canceled':
        await this.userService.updateKycStatus(userId, 'CANCELED', session.id);
        break;
    }

    return { received: true };
  }
}
