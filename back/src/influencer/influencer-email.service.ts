import { Injectable, Logger } from '@nestjs/common';
import { MailerService } from '@nestjs-modules/mailer';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class InfluencerEmailService {
  private readonly logger = new Logger(InfluencerEmailService.name);

  constructor(
    private readonly mailerService: MailerService,
    private readonly configService: ConfigService,
  ) {}

  async sendInfluencerInvite(email: string, firstName: string, hash: string) {
    const frontendUrl =
      this.configService.get<string>('FRONTEND_URL') || 'http://localhost:4200';
    const registrationUrl = `${frontendUrl}/register?from=${hash}`;

    try {
      await this.mailerService.sendMail({
        to: email,
        subject: 'Votre lien Reloke est prêt ! 🚀',
        template: 'influencer-invite',
        context: {
          firstName,
          registrationUrl,
        },
      });
      this.logger.log(`Affiliate link email sent to influencer: ${email}`);
    } catch (error) {
      this.logger.error(
        `Failed to send influencer invite email to ${email}`,
        error.stack,
      );
      throw error;
    }
  }
}
