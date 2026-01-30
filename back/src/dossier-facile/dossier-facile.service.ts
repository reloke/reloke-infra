import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { Cron, CronExpression } from '@nestjs/schedule';
import { MailService } from '../mail/mail.service';
import { MatchStatus } from '@prisma/client';

@Injectable()
export class DossierFacileService {
  private readonly logger = new Logger(DossierFacileService.name);
  private readonly isDebugMode: boolean;

  // Supporte les deux domaines : dossierfacile.logement.gouv.fr ET dossierfacile.fr
  private readonly dfRegex =
    /^https?:\/\/(www|locataire)\.(dossierfacile\.logement\.gouv\.fr|dossierfacile\.fr)\/(file|public-file|links|linkds|dossier|d)\/.+/;

  // URL debug stricte — ne match qu'une seule URL précise
  private readonly DEBUG_URL =
    'https://www.dossierfacile.fr/file/test-debug-123';
  private readonly DEBUG_PING_URL =
    'https://www.dossierfacile.logement.gouv.fr/';

  constructor(
    private readonly prisma: PrismaService,
    private readonly httpService: HttpService,
    private readonly mailService: MailService,
    private readonly configService: ConfigService,
  ) {
    this.isDebugMode =
      this.configService.get<string>('DOSSIER_FACILE_DEBUG') === 'true';
    if (this.isDebugMode) {
      this.logger.warn(
        '[DossierFacileService] DEBUG MODE ENABLED — debug URL will be accepted',
      );
    }
  }

  /**
   * Validates the DossierFacile URL format and accessibility.
   * Returns a structured result with isValid, error message and HTTP code.
   */
  async validateUrl(
    url: string,
  ): Promise<{ isValid: boolean; error?: string; httpCode?: number }> {
    this.logger.log(`[validateUrl] Starting validation for: ${url}`);

    if (!url) {
      return { isValid: false, error: 'URL is required', httpCode: 400 };
    }

    // 1. Debug mode — only exact match and only when env var is set
    if (this.isDebugMode && url === this.DEBUG_URL) {
      this.logger.log(
        '[validateUrl] DEBUG MODE — accepted debug URL, pinging DossierFacile site...',
      );
      try {
        const pingResponse = await firstValueFrom(
          this.httpService.get(this.DEBUG_PING_URL, {
            timeout: 8000,
            validateStatus: () => true,
            headers: { 'User-Agent': 'Reloke-LinkChecker/1.0' },
          }),
        );
        this.logger.log(
          `[validateUrl] DEBUG ping status: ${pingResponse.status}`,
        );
        if (pingResponse.status >= 200 && pingResponse.status < 400) {
          return { isValid: true, httpCode: 200 };
        }
        return {
          isValid: false,
          error: `Le site DossierFacile est inaccessible (Erreur ${pingResponse.status})`,
          httpCode: pingResponse.status,
        };
      } catch (err) {
        this.logger.error(`[validateUrl] DEBUG ping failed: ${err.message}`);
        return {
          isValid: false,
          error:
            'Le site DossierFacile est inaccessible. Veuillez réessayer plus tard.',
          httpCode: 503,
        };
      }
    }

    // 2. Regex format check
    if (!this.dfRegex.test(url)) {
      this.logger.warn(`[validateUrl] URL failed regex: ${url}`);
      return {
        isValid: false,
        error:
          "Le format du lien n'est pas reconnu comme un lien de partage DossierFacile valide",
        httpCode: 400,
      };
    }

    // 3. HTTP accessibility check
    try {
      this.logger.log(`[validateUrl] HTTP GET check for: ${url}`);
      const response = await firstValueFrom(
        this.httpService.get(url, {
          timeout: 8000,
          validateStatus: () => true,
          headers: {
            'User-Agent': 'Reloke-LinkChecker/1.0',
            Accept: 'text/html,application/xhtml+xml',
          },
        }),
      );

      this.logger.log(`[validateUrl] HTTP response: ${response.status}`);

      if (response.status === 200) {
        return { isValid: true, httpCode: 200 };
      }

      return {
        isValid: false,
        error: `Le lien DossierFacile semble invalide ou inaccessible (Erreur ${response.status})`,
        httpCode: response.status,
      };
    } catch (error) {
      this.logger.error(`[validateUrl] HTTP check failed: ${error.message}`);
      return {
        isValid: false,
        error: 'Le lien DossierFacile semble invalide ou inaccessible',
        httpCode: 503,
      };
    }
  }

  /**
   * Extracts UUID/identifier from any accepted DossierFacile path.
   * Covers /file/, /public-file/, /links/, /linkds/, /dossier/, /d/
   */
  private extractIdentifier(url: string): string {
    const match = url.match(
      /\/(file|public-file|links|linkds|dossier|d)\/([a-zA-Z0-9_-]+)/,
    );
    return match ? match[2] : 'unknown';
  }

  /**
   * Periodic check of all active DossierFacile links (daily at 3 AM).
   * Uses the stored dossierFacileUrl instead of reconstructing from UUID.
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async checkAllActiveLinks() {
    this.logger.log('Starting periodic check of DossierFacile links...');

    const links = await this.prisma.dossierFacileLink.findMany({
      where: { status: 'OK' },
      include: { user: true },
    });

    let invalidatedCount = 0;

    for (const link of links) {
      // Use stored URL, fallback to legacy reconstruction
      const url =
        link.dossierFacileUrl ||
        `https://locataire.dossierfacile.logement.gouv.fr/file/${link.uuid}`;

      const { isValid, error, httpCode } = await this.validateUrl(url);

      if (!isValid) {
        await this.prisma.dossierFacileLink.update({
          where: { id: link.id },
          data: {
            status: 'KO',
            lastCheckedAt: new Date(),
            lastError: error,
            lastHttpCode: httpCode,
          },
        });

        await this.prisma.user.update({
          where: { id: link.userId },
          data: { isDossierValid: false },
        });

        invalidatedCount++;
        this.logger.warn(
          `Link for user ${link.userId} became invalid. Sending email.`,
        );
        try {
          await this.mailService.sendDossierFacileInvalidEmail(
            link.user.mail,
            link.user.firstName,
          );
        } catch (e) {
          this.logger.error(e);
        }
      } else {
        await this.prisma.dossierFacileLink.update({
          where: { id: link.id },
          data: {
            lastCheckedAt: new Date(),
            lastHttpCode: httpCode,
            lastError: null,
          },
        });
      }
    }

    this.logger.log(
      `Periodic check completed. ${links.length} checked, ${invalidatedCount} invalidated.`,
    );
  }

  /**
   * Weekly reminder for users with missing DossierFacile link
   * but who have active matches (every Monday at 10 AM).
   */
  @Cron('0 0 10 * * 1')
  async sendMissingDossierReminders() {
    this.logger.log('Starting weekly DossierFacile reminders...');

    const usersToRemind = await this.prisma.user.findMany({
      where: {
        dossierFacileLink: null,
        deletedAt: null,
        intents: {
          some: {
            OR: [
              {
                matchesAsSeeker: { some: { status: MatchStatus.IN_PROGRESS } },
              },
              {
                matchesAsTarget: { some: { status: MatchStatus.IN_PROGRESS } },
              },
              { matchesAsSeeker: { some: { status: MatchStatus.NEW } } },
              { matchesAsTarget: { some: { status: MatchStatus.NEW } } },
            ],
          },
        },
      },
    });

    for (const user of usersToRemind) {
      try {
        await this.mailService.sendDossierFacileReminderEmail(
          user.mail,
          user.firstName,
        );
      } catch (error) {
        this.logger.error(
          `Failed to send reminder to ${user.mail}: ${error.message}`,
        );
      }
    }
  }

  /**
   * Saves the DossierFacile link for a user after validation.
   * Throws BadRequestException if validation fails.
   */
  async updateDossierUrl(userId: number, url: string) {
    this.logger.log(`[updateDossierUrl] User ${userId} requested update.`);

    // Clear case
    if (!url) {
      this.logger.log(`[updateDossierUrl] Clearing URL for user ${userId}`);
      await this.prisma.dossierFacileLink.deleteMany({ where: { userId } });
      return this.prisma.user.update({
        where: { id: userId },
        data: {
          dossierFacileUrl: null,
          isDossierValid: false,
          lastDossierCheckAt: new Date(),
        },
      });
    }

    // Validate
    const { isValid, error, httpCode } = await this.validateUrl(url);

    if (!isValid) {
      throw new BadRequestException(error || 'URL invalide');
    }

    // Extract identifier from any accepted path
    const uuid = this.extractIdentifier(url);

    // Upsert DossierFacileLink with full URL stored
    await this.prisma.dossierFacileLink.upsert({
      where: { userId },
      create: {
        userId,
        uuid,
        dossierFacileUrl: url,
        status: 'OK',
        lastCheckedAt: new Date(),
        lastHttpCode: httpCode,
      },
      update: {
        uuid,
        dossierFacileUrl: url,
        status: 'OK',
        lastCheckedAt: new Date(),
        lastHttpCode: httpCode,
        lastError: null,
      },
    });

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        dossierFacileUrl: url,
        isDossierValid: true,
        lastDossierCheckAt: new Date(),
      },
    });

    // Send confirmation email (fire and forget)
    this.mailService
      .sendDossierFacileValidatedEmail(user.mail, user.firstName, url)
      .catch((err) =>
        this.logger.error(`[updateDossierUrl] email failed: ${err.message}`),
      );

    return user;
  }
}
