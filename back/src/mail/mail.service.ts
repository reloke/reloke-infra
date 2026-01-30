import {
  SendEmailCommand,
  SendEmailCommandInput,
  SESClient,
} from '@aws-sdk/client-ses';
import { Injectable, Logger } from '@nestjs/common';
import { AwsConfigService } from 'src/aws/aws-config.service';
import * as path from 'path';
import * as fs from 'fs';
import * as Handlebars from 'handlebars';
import { EmailOptions } from './dto/mail.dto';
import { ConfigService } from '@nestjs/config';

/**
 * Centralized brand constants for all email templates.
 * These are automatically injected into every email context.
 */
interface MailBrandConfig {
  brandName: string;
  logoUrl: string;
  primaryColor: string;
  frontendUrl: string;
  supportEmail: string;
  companyAddress: string;
  // Social links
  facebookUrl: string;
  instagramUrl: string;
  twitterUrl: string;
  youtubeUrl: string;
  linkedinUrl: string;
  // S3 asset URLs
  facebookIconUrl: string;
  instagramIconUrl: string;
  twitterIconUrl: string;
  youtubeIconUrl: string;
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private sesClient: SESClient;
  private templatesPath: string;
  private partialsPath: string;
  private partialsRegistered = false;

  /**
   * Centralized brand configuration - single source of truth for all emails
   */
  private readonly brandConfig: MailBrandConfig;

  constructor(
    private awsConfigService: AwsConfigService,
    private configService: ConfigService,
  ) {
    this.sesClient = new SESClient({
      region: this.awsConfigService.region,
      credentials: this.awsConfigService.credentials,
    });

    this.templatesPath = path.join(process.cwd(), 'src', 'templates', 'mails');
    this.partialsPath = path.join(this.templatesPath, 'partials');

    // Initialize brand config from environment with fallbacks
    const frontendUrl =
      this.configService.get<string>('FRONTEND_URL') || 'https://reloke.com';
    this.brandConfig = {
      brandName: 'Reloke',
      logoUrl:
        'https://reloke.s3.eu-west-3.amazonaws.com/general/logo-mail.png',
      primaryColor: '#C25E46',
      frontendUrl,
      supportEmail: 'support@reloke.com',
      companyAddress: '12 Avenue des Champs-Élysées, 75008 Paris',
      // Social links
      facebookUrl: 'http://facebook.com/relokeofficial',
      instagramUrl: 'https://www.instagram.com/reloke_official/',
      twitterUrl: 'https://x.com/reloke_official',
      youtubeUrl: 'https://www.youtube.com/channel/UCFYElN8kqmrwPD4lC9OKQWg',
      linkedinUrl: 'https://linkedin.com/company/reloke',
      // S3 icon URLs
      facebookIconUrl:
        'https://reloke.s3.eu-west-3.amazonaws.com/general/facebook.png',
      instagramIconUrl:
        'https://reloke.s3.eu-west-3.amazonaws.com/general/instagram.png',
      twitterIconUrl: 'https://reloke.s3.eu-west-3.amazonaws.com/general/x.png',
      youtubeIconUrl:
        'https://reloke.s3.eu-west-3.amazonaws.com/general/youtube.png',
    };

    // Register Handlebars partials
    this.registerPartials();
  }

  /**
   * Register Handlebars partials for reusable email components
   */
  private registerPartials(): void {
    if (this.partialsRegistered) return;

    try {
      // Check if partials directory exists
      if (!fs.existsSync(this.partialsPath)) {
        fs.mkdirSync(this.partialsPath, { recursive: true });
        this.logger.log(`Created partials directory: ${this.partialsPath}`);
      }

      // Register all .hbs files in partials directory
      const partialFiles = fs
        .readdirSync(this.partialsPath)
        .filter((f) => f.endsWith('.hbs'));
      for (const file of partialFiles) {
        const partialName = file.replace('.hbs', '');
        const partialContent = fs.readFileSync(
          path.join(this.partialsPath, file),
          'utf-8',
        );
        Handlebars.registerPartial(partialName, partialContent);
        this.logger.debug(`Registered partial: ${partialName}`);
      }

      this.partialsRegistered = true;
      this.logger.log(`Registered ${partialFiles.length} email partials`);
    } catch (error) {
      this.logger.warn(`Could not register partials: ${error.message}`);
    }
  }

  /**
   * Vérifie la configuration SES
   */
  async verifyConfiguration(): Promise<boolean> {
    try {
      this.logger.log('Vérification de la configuration AWS SES...');
      this.logger.log(`Region: ${this.awsConfigService.region}`);
      this.logger.log(`From Email: ${this.awsConfigService.fromEmail}`);
      return true;
    } catch (error) {
      this.logger.error('Erreur de configuration SES:', error);
      return false;
    }
  }

  /**
   * Compile un template Handlebars avec les données fournies.
   * Automatically injects brand config and year into context.
   */
  private compileTemplate(
    templateName: string,
    context: Record<string, any>,
  ): string {
    try {
      const templatePath = path.join(this.templatesPath, `${templateName}.hbs`);
      const templateContent = fs.readFileSync(templatePath, 'utf-8');
      const template = Handlebars.compile(templateContent);

      // Merge brand config with provided context
      // Brand config provides fallbacks, specific context can override
      const fullContext = {
        ...this.brandConfig,
        year: new Date().getFullYear(),
        ...context,
      };

      return template(fullContext);
    } catch (error) {
      this.logger.error(
        `Erreur lors de la compilation du template ${templateName}:`,
        error,
      );
      throw new Error(`Template ${templateName} non trouvé ou invalide`);
    }
  }

  /**
   * Envoie un email via AWS SES
   */
  async sendEmail(options: EmailOptions): Promise<boolean> {
    this.logger.log(
      `[sendEmail] Triggered for template: ${options.template} to: ${JSON.stringify(options.to)}`,
    );
    try {
      let htmlContent: string;
      let textContent: string;

      // Si un template est fourni, on le compile
      if (options.template && options.context) {
        htmlContent = this.compileTemplate(options.template, options.context);
        // Générer une version texte simple à partir du HTML
        textContent = this.htmlToText(htmlContent);
      } else {
        htmlContent = options.html || '';
        textContent = options.text || '';
      }

      // Préparer les destinataires
      // HACK: AWS SES Sandbox - Force recipient to verified email
      const recipients = ['support@reloke.com'];
      // const recipients = Array.isArray(options.to) ? options.to : [options.to];

      const params: SendEmailCommandInput = {
        Source: `${this.awsConfigService.fromName} <${this.awsConfigService.fromEmail}>`,
        Destination: {
          ToAddresses: recipients,
        },
        Message: {
          Subject: {
            Data: options.subject,
            Charset: 'UTF-8',
          },
          Body: {
            Html: {
              Data: htmlContent,
              Charset: 'UTF-8',
            },
            Text: {
              Data: textContent,
              Charset: 'UTF-8',
            },
          },
        },
      };

      const command = new SendEmailCommand(params);
      const response = await this.sesClient.send(command);

      this.logger.log(
        `Email envoyé avec succès à ${recipients.join(', ')} - MessageId: ${response.MessageId}`,
      );
      return true;
    } catch (error) {
      console.error(
        `[sendEmail] DETAILED ERROR for template ${options.template}:`,
        error,
      );
      this.logger.error(`Erreur lors de l'envoi de l'email:`, error);
      throw error;
    }
  }

  /**
   * Envoie un email quand la vérification d'identité passe en revue manuelle
   */
  async sendIdentityVerificationManualReviewEmail(
    email: string,
    firstName: string,
  ): Promise<boolean> {
    return this.sendEmail({
      to: email,
      subject: "Vérification d'identité en cours d'analyse",
      template: 'identity-verification-manual-review',
      context: {
        firstName: firstName || 'Utilisateur',
        dashboardUrl: `${this.brandConfig.frontendUrl}/dashboard`,
      },
    });
  }

  /**
   * Envoie un email de vérification avec code OTP
   */
  async sendVerificationEmail(
    email: string,
    userName: string,
    otpCode: string,
  ): Promise<boolean> {
    return this.sendEmail({
      to: email,
      subject: 'Vérifiez votre adresse email',
      template: 'verification-email',
      context: { userName: userName || 'Utilisateur', otpCode },
    });
  }

  /**
   * Envoie un email de bienvenue
   */
  async sendWelcomeEmail(email: string, userName: string): Promise<boolean> {
    return this.sendEmail({
      to: email,
      subject: 'Bienvenue sur Reloke !',
      template: 'welcome-email',
      context: { userName: userName || 'Utilisateur' },
    });
  }

  /**
   * Envoie un email de réinitialisation de mot de passe
   */
  async sendPasswordResetEmail(
    email: string,
    userName: string,
    token: string,
  ): Promise<boolean> {
    return this.sendEmail({
      to: email,
      subject: 'Réinitialisation de votre mot de passe',
      template: 'reset-password',
      context: { userName: userName || 'Utilisateur', token },
    });
  }

  async sendChangeEmailRequest(
    email: string,
    userName: string,
    otpCode: string,
  ): Promise<boolean> {
    return this.sendEmail({
      to: email,
      subject: "Demande de changement d'email",
      template: 'change-email-request',
      context: { userName: userName || 'Utilisateur', otpCode },
    });
  }

  async sendNewEmailVerification(
    email: string,
    userName: string,
    otpCode: string,
  ): Promise<boolean> {
    return this.sendEmail({
      to: email,
      subject: 'Vérifiez votre nouvelle adresse email',
      template: 'verify-new-email',
      context: { userName: userName || 'Utilisateur', otpCode },
    });
  }

  /**
   * Envoie un email de confirmation de modification de mot de passe
   */
  async sendPasswordUpdatedEmail(
    email: string,
    userName: string,
  ): Promise<boolean> {
    return this.sendEmail({
      to: email,
      subject: 'Votre mot de passe a été modifié',
      template: 'password-updated',
      context: { userName: userName || 'Utilisateur' },
    });
  }

  /**
   * Envoie un email de confirmation de modification d'adresse email
   */
  async sendEmailUpdatedEmail(
    email: string,
    userName: string,
    newEmail: string,
  ): Promise<boolean> {
    return this.sendEmail({
      to: email,
      subject: 'Votre adresse email a été modifiée',
      template: 'email-updated',
      context: {
        userName: userName || 'Utilisateur',
        newEmail: newEmail,
      },
    });
  }

  /**
   * Envoie un email de confirmation de demande de suppression
   */
  async sendDeletionRequestEmail(
    email: string,
    userName: string,
    scheduledDate: Date,
    wasInFlow: boolean = false,
    refundTriggered: boolean = false,
    refundedMatches: number = 0,
    refundedAmount: number = 0,
  ): Promise<boolean> {
    const formattedDate = scheduledDate.toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });

    return this.sendEmail({
      to: email,
      subject: 'Confirmation de votre demande de suppression - Reloke',
      template: 'account-deletion-request',
      context: {
        userName,
        scheduledDate: formattedDate,
        wasInFlow,
        refundTriggered,
        refundedMatches,
        refundedAmount: refundedAmount.toFixed(2).replace('.', ','),
      },
    });
  }

  /**
   * Envoie un email de restauration de compte
   */
  async sendAccountRestoredEmail(
    email: string,
    userName: string,
  ): Promise<boolean> {
    return this.sendEmail({
      to: email,
      subject: 'Votre compte a été restauré',
      template: 'account-restored',
      context: { userName: userName || 'Utilisateur' },
    });
  }

  /**
   * Convertit du HTML simple en texte brut
   */
  private htmlToText(html: string): string {
    return html
      .replace(/<style[^>]*>.*<\/style>/gm, '')
      .replace(/<script[^>]*>.*<\/script>/gm, '')
      .replace(/<[^>]+>/gm, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
  async sendInfluencerWelcomeEmail(
    email: string,
    firstName: string,
    tempPassword?: string,
  ): Promise<boolean> {
    return this.sendEmail({
      to: email,
      subject: 'Bienvenue dans le programme influenceur Reloke !',
      template: 'influencer-invite', // Uising invite template as welcome for now or until dedicated one
      context: {
        firstName: firstName || 'Influenceur',
        email,
        password: tempPassword,
        registrationUrl:
          this.configService.get<string>('FRONTEND_URL') ||
          'http://localhost:4200',
        year: new Date().getFullYear(),
      },
    });
  }

  async sendInfluencerInviteEmail(
    email: string,
    firstName: string,
    registrationUrl: string,
  ): Promise<boolean> {
    return this.sendEmail({
      to: email,
      subject: 'Votre lien Reloke est prêt ! 🚀',
      template: 'influencer-invite',
      context: {
        firstName,
        registrationUrl,
        year: new Date().getFullYear(),
        frontendUrl:
          this.configService.get<string>('FRONTEND_URL') ||
          'http://localhost:4200',
      },
    });
  }

  async sendInfluencerReportEmail(
    email: string,
    firstName: string,
    promoCodes: any[],
    totalUsage: number,
  ): Promise<boolean> {
    return this.sendEmail({
      to: email,
      subject: 'Votre rapport de performance Reloke 📈',
      template: 'influencer-report',
      context: {
        firstName: firstName || 'Influenceur',
        promoCodes,
        totalCodes: promoCodes.length,
        totalUsage,
      },
    });
  }

  // ============================================================
  // Matching & Payment Emails
  // ============================================================

  /**
   * Send email notification when new matches are found
   * Called by MatchingWorkerService after successful matching
   */
  async sendMatchesFoundEmail(
    email: string,
    userName: string,
    matchCount: number,
    remainingCredits: number,
  ): Promise<boolean> {
    const displayName = userName || 'Utilisateur';
    const subject =
      matchCount === 1
        ? '1 nouveau match disponible !'
        : `${matchCount} nouveaux matchs disponibles !`;

    this.logger.log(
      `[EMAIL] Sending matches-found email to ${email}: ${matchCount} matches`,
    );

    return this.sendEmail({
      to: email,
      subject,
      template: 'matches-found',
      context: {
        userName: displayName,
        userEmail: email,
        matchCount,
        isPlural: matchCount > 1,
        remainingCredits,
        hasMultipleCredits: remainingCredits !== 1,
        hasNoCredits: remainingCredits === 0,
        matchesUrl: `${this.brandConfig.frontendUrl}/home/dashboard`,
      },
    });
  }

  /**
   * Send email confirmation after successful payment
   * Called by MatchingPaymentsService after payment success
   */
  async sendPaymentSuccessEmail(
    email: string,
    userName: string,
    packLabel: string,
    matchesPurchased: number,
    amountTotal: number,
    totalCredits: number,
    transactionId: string,
  ): Promise<boolean> {
    const displayName = userName || 'Utilisateur';

    const paymentDateFormatter = new Intl.DateTimeFormat('fr-FR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    this.logger.log(
      `[EMAIL] Sending payment-success email to ${email}: ${matchesPurchased} matches, ${amountTotal}€`,
    );

    return this.sendEmail({
      to: email,
      subject: 'Paiement confirme - Vos credits sont disponibles !',
      template: 'payment-success',
      context: {
        userName: displayName,
        userEmail: email,
        packLabel,
        matchesPurchased,
        hasMultipleMatches: matchesPurchased > 1,
        amountTotal: amountTotal.toFixed(2).replace('.', ','),
        totalCredits,
        hasMultipleCredits: totalCredits !== 1,
        paymentDate: paymentDateFormatter.format(new Date()),
        transactionId,
        dashboardUrl: `${this.brandConfig.frontendUrl}/dashboard`,
      },
    });
  }

  /**
   * Send email notification after payment failure
   * Called by MatchingPaymentsService after payment failure
   */
  async sendPaymentFailedEmail(
    email: string,
    userName: string,
    packLabel: string,
    amountTotal: number,
    sessionId: string,
  ): Promise<boolean> {
    const displayName = userName || 'Utilisateur';

    const attemptDateFormatter = new Intl.DateTimeFormat('fr-FR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    this.logger.log(
      `[EMAIL] Sending payment-failed email to ${email}: ${packLabel}, ${amountTotal}€`,
    );

    return this.sendEmail({
      to: email,
      subject: 'Echec du paiement - Action requise',
      template: 'payment-failed',
      context: {
        userName: displayName,
        userEmail: email,
        packLabel,
        amountTotal: amountTotal.toFixed(2).replace('.', ','),
        attemptDate: attemptDateFormatter.format(new Date()),
        sessionId,
        retryUrl: `${this.brandConfig.frontendUrl}/matching/payment`,
      },
    });
  }

  /**
   * Send email confirmation after refund request
   * Called by MatchingPaymentsService after successful refund
   */
  async sendRefundConfirmationEmail(
    email: string,
    userName: string,
    refundAmount: number,
    matchesRefunded: number,
    cooldownEndDate: Date,
    transactionId: string,
  ): Promise<boolean> {
    const displayName = userName || 'Utilisateur';

    const formatter = new Intl.DateTimeFormat('fr-FR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    const refundDateFormatter = new Intl.DateTimeFormat('fr-FR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    this.logger.log(
      `[EMAIL] Sending refund-confirmation email to ${email}: ${refundAmount}€, txId=${transactionId}`,
    );

    return this.sendEmail({
      to: email,
      subject: 'Confirmation de votre remboursement',
      template: 'refund-confirmation',
      context: {
        userName: displayName,
        userEmail: email,
        refundAmount: refundAmount.toFixed(2).replace('.', ','),
        matchesRefunded,
        hasMultipleMatches: matchesRefunded > 1,
        refundDate: refundDateFormatter.format(new Date()),
        cooldownEndDate: formatter.format(cooldownEndDate),
        transactionId,
      },
    });
  }

  // ============================================================
  // Test / Preview Methods (for development)
  // ============================================================

  // ============================================================
  // Search Period Emails
  // ============================================================

  /**
   * Send email when user is in search period but has no credits
   * Called by SearchEmailCronService
   */
  async sendSearchInPeriodNoCreditsEmail(
    email: string,
    userName: string,
    searchStartDate: Date,
    searchEndDate: Date,
  ): Promise<boolean> {
    const displayName = userName || 'Utilisateur';

    const formatter = new Intl.DateTimeFormat('fr-FR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    this.logger.log(
      `[EMAIL] Sending search-in-period-no-credits email to ${email}`,
    );

    return this.sendEmail({
      to: email,
      subject: 'Votre recherche est en pause - Rechargez vos credits',
      template: 'search-in-period-no-credits',
      context: {
        userName: displayName,
        userEmail: email,
        searchStartDate: formatter.format(searchStartDate),
        searchEndDate: formatter.format(searchEndDate),
        ctaUrl: `${this.brandConfig.frontendUrl}/matching/payment`,
        ctaText: 'Recharger mes credits',
      },
    });
  }

  /**
   * Send email when user's search period has expired
   * Called by SearchEmailCronService
   */
  async sendSearchPeriodExpiredEmail(
    email: string,
    userName: string,
    searchStartDate: Date,
    searchEndDate: Date,
  ): Promise<boolean> {
    const displayName = userName || 'Utilisateur';

    const formatter = new Intl.DateTimeFormat('fr-FR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    this.logger.log(`[EMAIL] Sending search-period-expired email to ${email}`);

    return this.sendEmail({
      to: email,
      subject: 'Votre periode de recherche est terminee',
      template: 'search-period-expired',
      context: {
        userName: displayName,
        userEmail: email,
        searchStartDate: formatter.format(searchStartDate),
        searchEndDate: formatter.format(searchEndDate),
        ctaUrlPrimary: `${this.brandConfig.frontendUrl}/dashboard`,
        ctaLabelPrimary: 'Mettre a jour ma periode',
        ctaUrlSecondary: `${this.brandConfig.frontendUrl}/dashboard?stopSearch=1`,
        ctaLabelSecondary: 'Je ne cherche plus',
      },
    });
  }

  // ============================================================
  // Help/Support Request Emails
  // ============================================================

  /**
   * Send confirmation email to user after submitting a help request
   */
  async sendHelpRequestConfirmationEmail(
    email: string,
    userName: string,
    requestUid: string,
    topicLabel: string,
  ): Promise<boolean> {
    const displayName = userName || 'Utilisateur';

    this.logger.log(
      `[EMAIL] Sending help-request-confirmation email to ${email} for request ${requestUid}`,
    );

    return this.sendEmail({
      to: email,
      subject: "Votre demande d'aide a bien ete recue",
      template: 'help-request-confirmation',
      context: {
        userName: displayName,
        userEmail: email,
        requestUid,
        topicLabel,
        dashboardUrl: `${this.brandConfig.frontendUrl}/home/dashboard`,
      },
    });
  }

  /**
   * Send notification to admins when a new help request is submitted
   */
  async sendHelpRequestAdminNotification(
    adminEmails: string[],
    requestUid: string,
    topicLabel: string,
    userName: string,
  ): Promise<boolean> {
    this.logger.log(
      `[EMAIL] Sending help-request-admin-notification to ${adminEmails.length} admins`,
    );

    return this.sendEmail({
      to: adminEmails,
      subject: `Nouvelle demande d'aide - ${topicLabel}`,
      template: 'help-request-admin-notification',
      context: {
        requestUid,
        topicLabel,
        userName,
        adminUrl: `${this.brandConfig.frontendUrl}/admin/dashboard/help/${requestUid}`,
      },
    });
  }

  /**
   * Send email to user when their help request is resolved
   */
  async sendHelpRequestResolvedEmail(
    email: string,
    userName: string,
    requestUid: string,
    topicLabel: string,
    resolutionNote?: string,
  ): Promise<boolean> {
    const displayName = userName || 'Utilisateur';

    this.logger.log(
      `[EMAIL] Sending help-request-resolved email to ${email} for request ${requestUid}`,
    );

    return this.sendEmail({
      to: email,
      subject: "Votre demande d'aide a ete traitee",
      template: 'help-request-resolved',
      context: {
        userName: displayName,
        userEmail: email,
        requestUid,
        topicLabel,
        resolutionNote,
        hasResolutionNote: !!resolutionNote,
        dashboardUrl: `${this.brandConfig.frontendUrl}/home/dashboard`,
      },
    });
  }

  // ============================================================
  // Test / Preview Methods (for development)
  // ============================================================

  /**
   * Preview an email template without sending
   * Useful for development and testing
   */
  async previewTemplate(
    templateName: string,
    context: Record<string, any> = {},
  ): Promise<string> {
    // Add sample data for common fields if not provided
    const sampleContext = {
      userName: 'Jean Dupont',
      userEmail: 'jean.dupont@example.com',
      matchCount: 3,
      isPlural: true,
      remainingCredits: 5,
      hasMultipleCredits: true,
      refundAmount: '25,00',
      matchesRefunded: 5,
      hasMultipleMatches: true,
      refundDate: '20 décembre 2025 à 14:30',
      cooldownEndDate: '3 janvier 2026',
      transactionId: 'TXN-2025-001234',
      otpCode: '123456',
      ...context,
    };

    return this.compileTemplate(templateName, sampleContext);
  }

  async sendIdentityVerifiedEmail(
    email: string,
    userName: string,
  ): Promise<boolean> {
    return this.sendEmail({
      to: email,
      subject: 'Identité validée avec succès !',
      template: 'identity-verified',
      context: {
        userName,
        frontendUrl:
          this.configService.get<string>('FRONTEND_URL') ||
          'http://localhost:4200',
        year: new Date().getFullYear(),
      },
    });
  }

  async sendIdentityVerificationRetryEmail(
    email: string,
    userName: string,
    rejectionReason?: string,
  ): Promise<boolean> {
    return this.sendEmail({
      to: email,
      subject: "Action requise : vérification d'identité",
      template: 'identity-verification-retry',
      context: {
        userName,
        rejectionReason,
        frontendUrl:
          this.configService.get<string>('FRONTEND_URL') ||
          'http://localhost:4200',
        year: new Date().getFullYear(),
      },
    });
  }

  async sendBanEmail(
    email: string,
    userName: string,
    reason: string,
    customMessage: string,
    template: string = 'user-banned',
  ): Promise<boolean> {
    return this.sendEmail({
      to: email,
      subject: 'Notification concernant votre compte',
      template: template,
      context: {
        userName,
        reason,
        customMessage,
        year: new Date().getFullYear(),
      },
    });
  }

  // ============================================================
  // Admin Security Alert Emails
  // ============================================================

  // ============================================================
  // Public Contact Form Emails
  // ============================================================

  /**
   * Send confirmation email to user who submitted a contact form
   */
  async sendContactConfirmationEmail(
    email: string,
    topicLabel: string,
  ): Promise<boolean> {
    this.logger.log(`[EMAIL] Sending contact-confirmation email to ${email}`);

    return this.sendEmail({
      to: email,
      subject: 'Votre message a bien ete recu',
      template: 'contact-confirmation',
      context: {
        userEmail: email,
        topicLabel,
      },
    });
  }

  /**
   * Send notification to admins about a new contact form submission
   */
  async sendContactAdminNotification(
    adminEmails: string[],
    userEmail: string,
    topicLabel: string,
    description: string,
    ip: string,
  ): Promise<boolean> {
    this.logger.log(
      `[EMAIL] Sending contact-admin-notification to ${adminEmails.length} admins`,
    );

    return this.sendEmail({
      to: adminEmails,
      subject: `[Contact] Nouveau message - ${topicLabel}`,
      template: 'contact-admin-notification',
      context: {
        userEmail,
        topicLabel,
        description,
        ip,
        receivedAt: new Intl.DateTimeFormat('fr-FR', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        }).format(new Date()),
      },
    });
  }

  /**
   * Send security alert email to admin team
   * Used by AdminRateLimitService for warning, blocked, and blacklisted events
   */
  async sendAdminSecurityAlert(
    recipients: string[],
    alertType: 'warning' | 'blocked' | 'blacklisted',
    subject: string,
    data: Record<string, unknown>,
  ): Promise<boolean> {
    // Pre-computed styles based on alert type (no Handlebars helpers needed)
    const alertStyles = {
      warning: {
        label: 'Avertissement',
        color: '#FFC107',
        icon: '!',
        bgColor: '#FEF3C7',
        boxBgColor: '#FFFBEB',
        boxBorderColor: '#FDE68A',
        textColor: '#92400E',
      },
      blocked: {
        label: 'Bloque',
        color: '#FF5722',
        icon: '!',
        bgColor: '#FED7AA',
        boxBgColor: '#FFF7ED',
        boxBorderColor: '#FDBA74',
        textColor: '#9A3412',
      },
      blacklisted: {
        label: 'Blackliste',
        color: '#D32F2F',
        icon: '!',
        bgColor: '#FECACA',
        boxBgColor: '#FEF2F2',
        boxBorderColor: '#FCA5A5',
        textColor: '#991B1B',
      },
    };

    const style = alertStyles[alertType];

    this.logger.log(
      `[EMAIL] Sending admin-security-alert (${alertType}) to ${recipients.length} recipients`,
    );

    return this.sendEmail({
      to: recipients,
      subject: `[SECURITE] ${subject}`,
      template: 'admin-security-alert',
      context: {
        alertType,
        alertLabel: style.label,
        alertColor: style.color,
        alertIcon: style.icon,
        alertBgColor: style.bgColor,
        alertBoxBgColor: style.boxBgColor,
        alertBoxBorderColor: style.boxBorderColor,
        alertTextColor: style.textColor,
        subject,
        ...data,
        adminUrl: `${this.brandConfig.frontendUrl}/admin/dashboard`,
      },
    });
  }

  async sendNewMessageNotificationEmail(
    email: string,
    userName: string,
    senderName: string,
    messagePreview: string,
    chatId: number,
    matchGroupId?: string | number,
  ): Promise<boolean> {
    const ctaUrl = matchGroupId
      ? `${this.brandConfig.frontendUrl}/chat/${matchGroupId}`
      : `${this.brandConfig.frontendUrl}/chat/direct/${chatId}`;

    return this.sendEmail({
      to: email,
      subject: `Nouveau message de ${senderName}`,
      template: 'new-message-notification',
      context: {
        userName,
        senderName,
        messageContent: messagePreview,
        ctaUrl,
      },
    });
  }

  async sendDossierFacileInvalidEmail(
    email: string,
    userName: string,
  ): Promise<boolean> {
    return this.sendEmail({
      to: email,
      subject: "Votre lien DossierFacile n'est plus valide",
      template: 'dossier-facile-invalid',
      context: {
        userName,
        profileUrl: `${this.brandConfig.frontendUrl}/profile/personal-info`,
      },
    });
  }

  async sendDossierFacileReminderEmail(
    email: string,
    userName: string,
  ): Promise<boolean> {
    return this.sendEmail({
      to: email,
      subject: 'Optimisez vos chances avec DossierFacile ! 🚀',
      template: 'dossier-facile-reminder',
      context: {
        userName,
        profileUrl: `${this.brandConfig.frontendUrl}/profile/personal-info`,
      },
    });
  }

  async sendDossierFacileValidatedEmail(
    email: string,
    userName: string,
    dossierFacileUrl?: string,
  ): Promise<boolean> {
    return this.sendEmail({
      to: email,
      subject: 'Votre lien DossierFacile a été validé ✓',
      template: 'dossier-facile-validated',
      context: {
        userName,
        profileUrl: `${this.brandConfig.frontendUrl}/profile/account`,
        dossierFacileUrl,
      },
    });
  }
  async sendContactSharedEmail(
    email: string,
    userName: string,
    senderName: string,
    contactName: string,
    chatId: number,
    matchGroupId?: string | number,
  ): Promise<boolean> {
    const ctaUrl = matchGroupId
      ? `${this.brandConfig.frontendUrl}/chat/${matchGroupId}`
      : `${this.brandConfig.frontendUrl}/chat/direct/${chatId}`;

    return this.sendEmail({
      to: email,
      subject: `Nouveau contact gestionnaire partagé par ${senderName}`,
      template: 'contact-shared-notification',
      context: {
        userName,
        senderName,
        contactName,
        ctaUrl,
      },
    });
  }

  async sendContactUpdatedEmail(
    email: string,
    userName: string,
    senderName: string,
    contactName: string,
    chatId: number,
    matchGroupId?: string | number,
  ): Promise<boolean> {
    const ctaUrl = matchGroupId
      ? `${this.brandConfig.frontendUrl}/chat/${matchGroupId}`
      : `${this.brandConfig.frontendUrl}/chat/direct/${chatId}`;

    return this.sendEmail({
      to: email,
      subject: `Mise à jour d'un contact gestionnaire par ${senderName}`,
      template: 'contact-updated-notification',
      context: {
        userName,
        senderName,
        contactName,
        ctaUrl,
      },
    });
  }
}
