import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { S3Service } from '../home/services/s3.service';
import { MailService } from '../mail/mail.service';
import { HelpService } from './help.service';
import {
  HelpRequestDto,
  HelpRequestListItemDto,
  PaginatedHelpRequestsDto,
  HelpRequestAttachmentDto,
} from './dto/help-request.dto';
import {
  ResolveHelpRequestDto,
  UserFullContextDto,
  UserHomeContextDto,
  UserSearchContextDto,
  UserCreditsContextDto,
  UserMatchContextDto,
  UserTransactionContextDto,
} from './dto/admin-help.dto';
import { HelpRequestStatus, HelpTopic } from '@prisma/client';

@Injectable()
export class AdminHelpService {
  private readonly logger = new Logger(AdminHelpService.name);
  private readonly DEFAULT_PAGE_SIZE = 20;

  constructor(
    private prisma: PrismaService,
    private s3Service: S3Service,
    private mailService: MailService,
    private helpService: HelpService,
  ) {}

  /**
   * List help requests with pagination and optional status filter
   */
  async listHelpRequests(
    status?: HelpRequestStatus,
    cursor?: string,
    limit?: number,
  ): Promise<PaginatedHelpRequestsDto> {
    const pageSize = limit || this.DEFAULT_PAGE_SIZE;

    // Build where clause
    const where: any = {};
    if (status) {
      where.status = status;
    }

    // Cursor-based pagination: fetch after the cursor
    const cursorClause: any = undefined;
    if (cursor) {
      const cursorRequest = await this.prisma.helpRequest.findUnique({
        where: { uid: cursor },
        select: { id: true, createdAt: true },
      });
      if (cursorRequest) {
        // Get items created before or at same time with smaller id
        where.OR = [
          { createdAt: { lt: cursorRequest.createdAt } },
          {
            createdAt: cursorRequest.createdAt,
            id: { lt: cursorRequest.id },
          },
        ];
      }
    }

    const [items, total] = await Promise.all([
      this.prisma.helpRequest.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: pageSize + 1, // Fetch one extra to check hasMore
        select: {
          uid: true,
          topic: true,
          status: true,
          createdAt: true,
          user: {
            select: {
              id: true,
              uid: true,
              firstName: true,
              lastName: true,
              mail: true,
            },
          },
          claimedBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              mail: true,
            },
          },
          attachments: {
            select: { id: true },
            take: 1,
          },
        },
      }),
      this.prisma.helpRequest.count({ where: status ? { status } : {} }),
    ]);

    const hasMore = items.length > pageSize;
    const resultItems = hasMore ? items.slice(0, pageSize) : items;
    const nextCursor = hasMore
      ? resultItems[resultItems.length - 1].uid
      : undefined;

    return {
      items: resultItems.map((r) => ({
        uid: r.uid,
        topic: r.topic,
        status: r.status,
        createdAt: r.createdAt,
        user: r.user,
        claimedBy: r.claimedBy,
        hasAttachments: r.attachments.length > 0,
      })),
      total,
      hasMore,
      nextCursor,
    };
  }

  /**
   * Get help request details (admin view)
   */
  async getHelpRequest(uid: string): Promise<HelpRequestDto> {
    const helpRequest = await this.prisma.helpRequest.findUnique({
      where: { uid },
      include: {
        user: {
          select: {
            id: true,
            uid: true,
            firstName: true,
            lastName: true,
            mail: true,
          },
        },
        claimedBy: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            mail: true,
          },
        },
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
      user: helpRequest.user,
      claimedBy: helpRequest.claimedBy,
      claimedAt: helpRequest.claimedAt,
      resolvedAt: helpRequest.resolvedAt,
      resolutionNote: helpRequest.resolutionNote,
    };
  }

  /**
   * Claim a help request (admin takes ownership)
   * Uses optimistic locking to handle concurrency
   */
  async claimHelpRequest(
    uid: string,
    adminId: number,
  ): Promise<HelpRequestDto> {
    // Use transaction with serializable isolation for concurrency safety
    return await this.prisma.$transaction(async (tx) => {
      const helpRequest = await tx.helpRequest.findUnique({
        where: { uid },
        select: {
          id: true,
          status: true,
          claimedById: true,
        },
      });

      if (!helpRequest) {
        throw new NotFoundException('Demande non trouvée');
      }

      if (helpRequest.status === HelpRequestStatus.RESOLVED) {
        throw new ConflictException('Cette demande est déjà résolue');
      }

      if (helpRequest.claimedById && helpRequest.claimedById !== adminId) {
        throw new ConflictException(
          'Cette demande est déjà prise en charge par un autre administrateur',
        );
      }

      // Claim the request
      const updated = await tx.helpRequest.update({
        where: { id: helpRequest.id },
        data: {
          status: HelpRequestStatus.IN_PROGRESS,
          claimedById: adminId,
          claimedAt: new Date(),
        },
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              mail: true,
            },
          },
          claimedBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              mail: true,
            },
          },
          attachments: {
            orderBy: { order: 'asc' },
          },
        },
      });

      this.logger.log(`Help request ${uid} claimed by admin ${adminId}`);

      const attachmentsWithUrls = await this.getAttachmentsWithUrls(
        updated.attachments,
      );

      return {
        uid: updated.uid,
        topic: updated.topic,
        description: updated.description,
        status: updated.status,
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
        attachments: attachmentsWithUrls,
        user: updated.user,
        claimedBy: updated.claimedBy,
        claimedAt: updated.claimedAt,
        resolvedAt: updated.resolvedAt,
        resolutionNote: updated.resolutionNote,
      };
    });
  }

  /**
   * Release a help request (admin gives up ownership)
   */
  async releaseHelpRequest(
    uid: string,
    adminId: number,
  ): Promise<HelpRequestDto> {
    const helpRequest = await this.prisma.helpRequest.findUnique({
      where: { uid },
      select: {
        id: true,
        status: true,
        claimedById: true,
      },
    });

    if (!helpRequest) {
      throw new NotFoundException('Demande non trouvée');
    }

    if (helpRequest.status === HelpRequestStatus.RESOLVED) {
      throw new ConflictException('Cette demande est déjà résolue');
    }

    if (helpRequest.claimedById !== adminId) {
      throw new ForbiddenException(
        'Vous ne pouvez libérer que les demandes que vous avez prises en charge',
      );
    }

    const updated = await this.prisma.helpRequest.update({
      where: { id: helpRequest.id },
      data: {
        status: HelpRequestStatus.OPEN,
        claimedById: null,
        claimedAt: null,
      },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            mail: true,
          },
        },
        claimedBy: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            mail: true,
          },
        },
        attachments: {
          orderBy: { order: 'asc' },
        },
      },
    });

    this.logger.log(`Help request ${uid} released by admin ${adminId}`);

    const attachmentsWithUrls = await this.getAttachmentsWithUrls(
      updated.attachments,
    );

    return {
      uid: updated.uid,
      topic: updated.topic,
      description: updated.description,
      status: updated.status,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
      attachments: attachmentsWithUrls,
      user: updated.user,
      claimedBy: updated.claimedBy,
      claimedAt: updated.claimedAt,
      resolvedAt: updated.resolvedAt,
      resolutionNote: updated.resolutionNote,
    };
  }

  /**
   * Resolve a help request
   */
  async resolveHelpRequest(
    uid: string,
    adminId: number,
    dto: ResolveHelpRequestDto,
  ): Promise<HelpRequestDto> {
    const helpRequest = await this.prisma.helpRequest.findUnique({
      where: { uid },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            mail: true,
          },
        },
      },
    });

    if (!helpRequest) {
      throw new NotFoundException('Demande non trouvée');
    }

    if (helpRequest.status === HelpRequestStatus.RESOLVED) {
      throw new ConflictException('Cette demande est déjà résolue');
    }

    // Only the admin who claimed can resolve, OR if not claimed yet, claim and resolve
    if (helpRequest.claimedById && helpRequest.claimedById !== adminId) {
      throw new ForbiddenException(
        'Vous ne pouvez résoudre que les demandes que vous avez prises en charge',
      );
    }

    const updated = await this.prisma.helpRequest.update({
      where: { id: helpRequest.id },
      data: {
        status: HelpRequestStatus.RESOLVED,
        claimedById: helpRequest.claimedById || adminId,
        claimedAt: helpRequest.claimedAt || new Date(),
        resolvedAt: new Date(),
        resolutionNote: dto.resolutionNote,
      },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            mail: true,
          },
        },
        claimedBy: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            mail: true,
          },
        },
        attachments: {
          orderBy: { order: 'asc' },
        },
      },
    });

    this.logger.log(`Help request ${uid} resolved by admin ${adminId}`);

    // Send resolution email to user (non-blocking)
    this.sendResolutionEmailAsync(
      updated.user.mail,
      updated.user.firstName || updated.user.lastName || 'Utilisateur',
      updated.uid,
      this.helpService.getTopicLabel(updated.topic),
      dto.resolutionNote,
    );

    const attachmentsWithUrls = await this.getAttachmentsWithUrls(
      updated.attachments,
    );

    return {
      uid: updated.uid,
      topic: updated.topic,
      description: updated.description,
      status: updated.status,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
      attachments: attachmentsWithUrls,
      user: updated.user,
      claimedBy: updated.claimedBy,
      claimedAt: updated.claimedAt,
      resolvedAt: updated.resolvedAt,
      resolutionNote: updated.resolutionNote,
    };
  }

  /**
   * Get user context for a help request (home, search, credits, matches, transactions)
   */
  async getUserContext(uid: string): Promise<UserFullContextDto> {
    const helpRequest = await this.prisma.helpRequest.findUnique({
      where: { uid },
      select: { userId: true },
    });

    if (!helpRequest) {
      throw new NotFoundException('Demande non trouvée');
    }

    const userId = helpRequest.userId;

    // Fetch all context data in parallel
    const [user, home, search, intent, recentMatches, recentTransactions] =
      await Promise.all([
        this.prisma.user.findUnique({
          where: { id: userId },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            mail: true,
            createdAt: true,
            isKycVerified: true,
            isBanned: true,
          },
        }),
        this.prisma.home.findUnique({
          where: { userId },
          select: {
            addressFormatted: true,
            homeType: true,
            nbRooms: true,
            surface: true,
            rent: true,
            images: { select: { id: true } },
          },
        }),
        this.prisma.search.findFirst({
          where: { userId },
          orderBy: { id: 'desc' },
          select: {
            minRent: true,
            maxRent: true,
            minRoomSurface: true,
            maxRoomSurface: true,
            homeType: true,
            searchStartDate: true,
            searchEndDate: true,
            searchAdresses: { select: { id: true } },
          },
        }),
        this.prisma.intent.findFirst({
          where: { userId },
          orderBy: { id: 'desc' },
          select: {
            totalMatchesPurchased: true,
            totalMatchesUsed: true,
            totalMatchesRemaining: true,
            isInFlow: true,
            isActivelySearching: true,
            refundCooldownUntil: true,
          },
        }),
        this.prisma.match.findMany({
          where: {
            seekerIntent: { userId },
          },
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: {
            uid: true,
            status: true,
            type: true,
            createdAt: true,
            targetHome: {
              select: {
                addressFormatted: true,
                homeType: true,
                rent: true,
              },
            },
          },
        }),
        this.prisma.transaction.findMany({
          where: { userId },
          orderBy: { occurredAt: 'desc' },
          take: 10,
          select: {
            id: true,
            type: true,
            status: true,
            amountTotal: true,
            occurredAt: true,
          },
        }),
      ]);

    if (!user) {
      throw new NotFoundException('Utilisateur non trouvé');
    }

    // Build home context
    const homeContext: UserHomeContextDto = {
      hasHome: !!home,
      home: home
        ? {
            addressFormatted: home.addressFormatted,
            homeType: home.homeType,
            nbRooms: home.nbRooms,
            surface: home.surface,
            rent: home.rent,
            imagesCount: home.images.length,
          }
        : undefined,
    };

    // Build search context
    const searchContext: UserSearchContextDto = {
      hasSearch: !!search,
      search: search
        ? {
            minRent: search.minRent,
            maxRent: search.maxRent,
            minRoomSurface: search.minRoomSurface,
            maxRoomSurface: search.maxRoomSurface,
            homeType: search.homeType as string[] | null,
            searchStartDate: search.searchStartDate,
            searchEndDate: search.searchEndDate,
            zonesCount: search.searchAdresses.length,
          }
        : undefined,
    };

    // Build credits context
    const creditsContext: UserCreditsContextDto = intent
      ? {
          totalMatchesPurchased: intent.totalMatchesPurchased,
          totalMatchesUsed: intent.totalMatchesUsed,
          totalMatchesRemaining: intent.totalMatchesRemaining,
          isInFlow: intent.isInFlow,
          isActivelySearching: intent.isActivelySearching,
          refundCooldownUntil: intent.refundCooldownUntil,
        }
      : {
          totalMatchesPurchased: 0,
          totalMatchesUsed: 0,
          totalMatchesRemaining: 0,
          isInFlow: false,
          isActivelySearching: false,
          refundCooldownUntil: null,
        };

    // Build matches context
    const matchesContext: UserMatchContextDto[] = recentMatches.map((m) => ({
      matchUid: m.uid,
      status: m.status,
      type: m.type,
      createdAt: m.createdAt,
      targetHome: {
        addressFormatted: m.targetHome.addressFormatted,
        homeType: m.targetHome.homeType,
        rent: m.targetHome.rent,
      },
    }));

    // Build transactions context
    const transactionsContext: UserTransactionContextDto[] =
      recentTransactions.map((t) => ({
        id: t.id,
        type: t.type,
        status: t.status,
        amountTotal: t.amountTotal,
        occurredAt: t.occurredAt,
      }));

    return {
      user,
      home: homeContext,
      search: searchContext,
      credits: creditsContext,
      recentMatches: matchesContext,
      recentTransactions: transactionsContext,
    };
  }

  /**
   * Get stats for admin dashboard
   */
  async getStats(): Promise<{
    open: number;
    inProgress: number;
    resolvedToday: number;
  }> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [open, inProgress, resolvedToday] = await Promise.all([
      this.prisma.helpRequest.count({
        where: { status: HelpRequestStatus.OPEN },
      }),
      this.prisma.helpRequest.count({
        where: { status: HelpRequestStatus.IN_PROGRESS },
      }),
      this.prisma.helpRequest.count({
        where: {
          status: HelpRequestStatus.RESOLVED,
          resolvedAt: { gte: today },
        },
      }),
    ]);

    return { open, inProgress, resolvedToday };
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
      }
    }

    return results;
  }

  /**
   * Send resolution email (async, non-blocking)
   */
  private async sendResolutionEmailAsync(
    email: string,
    userName: string,
    requestUid: string,
    topicLabel: string,
    resolutionNote?: string,
  ): Promise<void> {
    try {
      await this.mailService.sendHelpRequestResolvedEmail(
        email,
        userName,
        requestUid,
        topicLabel,
        resolutionNote,
      );
      this.logger.log(`Help request resolution email sent to ${email}`);
    } catch (error) {
      this.logger.error(
        `Failed to send help request resolution email: ${error.message}`,
      );
    }
  }
}
