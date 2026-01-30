import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { S3Service } from '../home/services/s3.service';
import { MailService } from '../mail/mail.service';
import { CreateHelpRequestDto } from './dto/create-help-request.dto';
import {
  CreateContactRequestDto,
  ContactTopic,
} from './dto/create-contact-request.dto';
import {
  HelpRequestDto,
  HelpRequestAttachmentDto,
  HelpRequestListItemDto,
  PaginatedHelpRequestsDto,
} from './dto/help-request.dto';
import { HelpTopic } from '@prisma/client';

@Injectable()
export class HelpService {
  private readonly logger = new Logger(HelpService.name);

  // Topic labels for emails and display
  private readonly topicLabels: Record<HelpTopic, string> = {
    HOME: 'Mon logement',
    SEARCH: 'Ma recherche',
    SEARCH_CRITERIA: 'Mes critères de recherche',
    MATCHES: 'Mes matchs',
    PAYMENTS: 'Paiements et crédits',
    OTHER: 'Autre',
  };

  // Contact topic labels for public contact form
  private readonly contactTopicLabels: Record<ContactTopic, string> = {
    ACCOUNT_ACCESS: "Probleme d'acces au compte",
    REGISTRATION: "Probleme d'inscription",
    HOW_IT_WORKS: 'Comment fonctionne Reloke ?',
    PARTNERSHIP: 'Partenariat / Presse',
    OTHER: 'Autre',
  };

  constructor(
    private prisma: PrismaService,
    private s3Service: S3Service,
    private mailService: MailService,
  ) {}

  /**
   * Upload a single attachment file to S3
   */
  async uploadAttachment(
    userId: number,
    file: Express.Multer.File,
  ): Promise<{ key: string }> {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

    if (!allowedTypes.includes(file.mimetype)) {
      throw new BadRequestException(
        `Type de fichier non autorisé: ${file.mimetype}. Types autorisés: JPEG, PNG, WebP, GIF`,
      );
    }

    const maxSize = 10 * 1024 * 1024; // 10 MB
    if (file.size > maxSize) {
      throw new BadRequestException(
        'Le fichier dépasse la taille maximale de 10 Mo',
      );
    }

    // Generate unique key
    const extension =
      file.originalname.split('.').pop()?.toLowerCase() || 'jpg';
    const uniqueId = require('crypto').randomUUID();
    const key = `help-attachments/${userId}/${uniqueId}.${extension}`;

    // Upload to S3
    await this.s3Service.uploadFile(file.buffer, key, file.mimetype);

    this.logger.log(`Help attachment uploaded: ${key}`);

    return { key };
  }

  /**
   * Create a new help request
   */
  async createHelpRequest(
    userId: number,
    dto: CreateHelpRequestDto,
  ): Promise<HelpRequestDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, firstName: true, lastName: true, mail: true },
    });

    if (!user) {
      throw new NotFoundException('Utilisateur non trouvé');
    }

    // Create help request with attachments
    const helpRequest = await this.prisma.helpRequest.create({
      data: {
        topic: dto.topic,
        description: dto.description,
        userId: userId,
        attachments: dto.attachmentKeys?.length
          ? {
              create: dto.attachmentKeys.map((key, index) => ({
                url: key,
                order: index,
              })),
            }
          : undefined,
      },
      include: {
        attachments: {
          orderBy: { order: 'asc' },
        },
      },
    });

    this.logger.log(
      `Help request ${helpRequest.uid} created by user ${userId} - topic: ${dto.topic}`,
    );

    // Send confirmation email to user (non-blocking)
    this.sendHelpRequestConfirmationEmailAsync(
      user.mail,
      user.firstName || user.lastName || 'Utilisateur',
      helpRequest.uid,
      this.topicLabels[dto.topic],
    );

    // Notify admins (non-blocking)
    this.notifyAdminsOfNewRequestAsync(helpRequest.uid, dto.topic, user);

    // Transform attachments to include signed URLs
    const attachmentsWithUrls = await this.getAttachmentsWithUrls(
      helpRequest.attachments,
    );

    return {
      uid: helpRequest.uid,
      topic: helpRequest.topic,
      description: helpRequest.description,
      status: helpRequest.status,
      createdAt: helpRequest.createdAt,
      updatedAt: helpRequest.updatedAt,
      attachments: attachmentsWithUrls,
    };
  }

  /**
   * Get user's help requests list
   */
  async getUserHelpRequests(userId: number): Promise<HelpRequestListItemDto[]> {
    const requests = await this.prisma.helpRequest.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        uid: true,
        topic: true,
        status: true,
        createdAt: true,
        attachments: {
          select: { id: true },
          take: 1,
        },
      },
    });

    return requests.map((r) => ({
      uid: r.uid,
      topic: r.topic,
      status: r.status,
      createdAt: r.createdAt,
      hasAttachments: r.attachments.length > 0,
    }));
  }

  /**
   * Get user's help requests list (cursor pagination)
   * Cursor uses HelpRequest.id (stable + unique).
   */
  async getUserHelpRequestsPaginated(
    userId: number,
    params: { cursor?: number; take: number },
  ): Promise<PaginatedHelpRequestsDto> {
    const total = await this.prisma.helpRequest.count({ where: { userId } });

    const items = await this.prisma.helpRequest.findMany({
      where: { userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      cursor: params.cursor ? { id: params.cursor } : undefined,
      skip: params.cursor ? 1 : 0,
      take: params.take + 1,
      select: {
        id: true,
        uid: true,
        topic: true,
        status: true,
        createdAt: true,
        attachments: {
          select: { id: true },
          take: 1,
        },
      },
    });

    const hasMore = items.length > params.take;
    const sliced = hasMore ? items.slice(0, params.take) : items;
    const nextCursor = hasMore
      ? String(sliced[sliced.length - 1]?.id)
      : undefined;

    return {
      items: sliced.map((r) => ({
        uid: r.uid,
        topic: r.topic,
        status: r.status,
        createdAt: r.createdAt,
        hasAttachments: r.attachments.length > 0,
      })),
      total,
      hasMore,
      nextCursor,
    };
  }

  /**
   * Get a specific help request for the user
   */
  async getUserHelpRequest(
    userId: number,
    uid: string,
  ): Promise<HelpRequestDto> {
    const helpRequest = await this.prisma.helpRequest.findFirst({
      where: { uid, userId },
      include: {
        attachments: {
          orderBy: { order: 'asc' },
        },
      },
    });

    if (!helpRequest) {
      throw new NotFoundException('Demande non trouvée');
    }

    const attachmentsWithUrls = await this.getAttachmentsWithUrls(
      helpRequest.attachments,
    );

    return {
      uid: helpRequest.uid,
      topic: helpRequest.topic,
      description: helpRequest.description,
      status: helpRequest.status,
      createdAt: helpRequest.createdAt,
      updatedAt: helpRequest.updatedAt,
      attachments: attachmentsWithUrls,
      resolvedAt: helpRequest.resolvedAt,
      resolutionNote: helpRequest.resolutionNote,
    };
  }

  /**
   * Get topic label
   */
  getTopicLabel(topic: HelpTopic): string {
    return this.topicLabels[topic];
  }

  /**
   * Transform attachments to include signed URLs
   */
  private async getAttachmentsWithUrls(
    attachments: { id: number; url: string; order: number }[],
  ): Promise<HelpRequestAttachmentDto[]> {
    const results: HelpRequestAttachmentDto[] = [];

    for (const att of attachments) {
      try {
        const signedUrl = await this.s3Service.getPublicUrl(att.url);
        results.push({
          id: att.id,
          url: signedUrl,
          order: att.order,
        });
      } catch (error) {
        this.logger.warn(`Failed to get signed URL for attachment ${att.id}`);
        // Skip failed attachments
      }
    }

    return results;
  }

  /**
   * Send confirmation email to user (async, non-blocking)
   */
  private async sendHelpRequestConfirmationEmailAsync(
    email: string,
    userName: string,
    requestUid: string,
    topicLabel: string,
  ): Promise<void> {
    try {
      await this.mailService.sendHelpRequestConfirmationEmail(
        email,
        userName,
        requestUid,
        topicLabel,
      );
      this.logger.log(`Help request confirmation email sent to ${email}`);
    } catch (error) {
      this.logger.error(
        `Failed to send help request confirmation email: ${error.message}`,
      );
    }
  }

  /**
   * Notify admins of new request (async, non-blocking)
   */
  private async notifyAdminsOfNewRequestAsync(
    requestUid: string,
    topic: HelpTopic,
    user: { firstName: string; lastName: string; mail: string },
  ): Promise<void> {
    try {
      // Get admin emails
      const admins = await this.prisma.user.findMany({
        where: { role: 'ADMIN', deletedAt: null },
        select: { mail: true },
      });

      const adminEmails = admins.map((a) => a.mail);
      if (adminEmails.length === 0) {
        this.logger.warn('No admins to notify for new help request');
        return;
      }

      await this.mailService.sendHelpRequestAdminNotification(
        adminEmails,
        requestUid,
        this.topicLabels[topic],
        `${user.firstName} ${user.lastName}`.trim() || user.mail,
      );
      this.logger.log(
        `Admin notification sent for help request ${requestUid} to ${adminEmails.length} admins`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to notify admins of new help request: ${error.message}`,
      );
    }
  }

  // ============================================================
  // Public Contact Form (no authentication required)
  // ============================================================

  /**
   * Process a public contact request
   * Sends confirmation email to user and notification to admins
   * No data is persisted in database
   */
  async processContactRequest(
    dto: CreateContactRequestDto,
    ip: string,
  ): Promise<void> {
    const topicLabel = this.contactTopicLabels[dto.topic];

    this.logger.log(
      `[Contact] Processing contact request - email: ${this.maskEmail(dto.email)}, topic: ${dto.topic}, ip: ${ip}`,
    );

    // Send confirmation email to user (non-blocking)
    this.sendContactConfirmationEmailAsync(dto.email, topicLabel);

    // Send notification to admins with full details (non-blocking)
    this.sendContactAdminNotificationAsync(
      dto.email,
      topicLabel,
      dto.description,
      ip,
    );
  }

  /**
   * Send confirmation email to contact form user
   */
  private async sendContactConfirmationEmailAsync(
    email: string,
    topicLabel: string,
  ): Promise<void> {
    try {
      await this.mailService.sendContactConfirmationEmail(email, topicLabel);
      this.logger.log(
        `[Contact] Confirmation email sent to ${this.maskEmail(email)}`,
      );
    } catch (error) {
      this.logger.error(
        `[Contact] Failed to send confirmation email: ${error.message}`,
      );
    }
  }

  /**
   * Send notification to admins about new contact request
   */
  private async sendContactAdminNotificationAsync(
    userEmail: string,
    topicLabel: string,
    description: string,
    ip: string,
  ): Promise<void> {
    try {
      // Get admin emails
      const admins = await this.prisma.user.findMany({
        where: { role: 'ADMIN', deletedAt: null },
        select: { mail: true },
      });

      const adminEmails = admins.map((a) => a.mail);
      if (adminEmails.length === 0) {
        this.logger.warn('[Contact] No admins to notify for contact request');
        return;
      }

      await this.mailService.sendContactAdminNotification(
        adminEmails,
        userEmail,
        topicLabel,
        description,
        ip,
      );
      this.logger.log(
        `[Contact] Admin notification sent to ${adminEmails.length} admins`,
      );
    } catch (error) {
      this.logger.error(`[Contact] Failed to notify admins: ${error.message}`);
    }
  }

  /**
   * Mask email for logging
   */
  private maskEmail(email: string): string {
    const [local, domain] = email.split('@');
    if (!domain) return '***';
    const maskedLocal =
      local.length > 2
        ? local[0] + '*'.repeat(local.length - 2) + local[local.length - 1]
        : '*'.repeat(local.length);
    return `${maskedLocal}@${domain}`;
  }
}
