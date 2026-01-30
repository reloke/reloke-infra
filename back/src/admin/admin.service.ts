import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { S3Service } from '../home/services/s3.service';
import { ChatGateway } from '../chat/chat.gateway';
import Decimal from 'decimal.js';
import { MatchingPaymentsService } from 'src/matching/services/matching-payments.service';

// Configure Decimal.js for precise financial calculations
Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

// Interfaces for financial stats
export interface FinancialStats {
  // Total revenue (sum of all successful payments)
  totalRevenue: string;
  // Revenue that belongs to us (matchesUsed * pricePerMatch)
  earnedRevenue: string;
  // Revenue refunded (matchesRefunded * pricePerMatch)
  refundedRevenue: string;
  // Pending revenue (matchesInitial - matchesUsed - matchesRefunded) * pricePerMatch
  pendingRevenue: string;
  // Match counts
  totalMatchesSold: number;
  totalMatchesUsed: number;
  totalMatchesRefunded: number;
  totalMatchesPending: number;
  // Payment counts
  totalPayments: number;
  successfulPayments: number;
  refundedPayments: number;
  partiallyRefundedPayments: number;
}

export interface TimeSeriesDataPoint {
  date: string;
  matchesUsed: number;
  revenueUsed: string;
  matchesRefunded: number;
  revenueRefunded: string;
}

export type TimeSeriesPeriod = 'day' | 'week' | 'month' | 'year';

export interface TimeSeriesResponse {
  period: TimeSeriesPeriod;
  data: TimeSeriesDataPoint[];
  totals: {
    matchesUsed: number;
    revenueUsed: string;
    matchesRefunded: number;
    revenueRefunded: string;
  };
}

@Injectable()
export class AdminService {
  constructor(
    private prisma: PrismaService,
    private mailService: MailService,
    private s3Service: S3Service,
    private chatGateway: ChatGateway,
    private matchingPaymentsService: MatchingPaymentsService,
  ) { }

  async getDashboardStats() {
    const totalUsers = await this.prisma.user.count();

    // Active Users: Users who have logged in or updated their profile in the last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const activeUsers = await this.prisma.user.count({
      where: {
        OR: [
          { dateLastConnection: { gte: thirtyDaysAgo } },
          { updatedAt: { gte: thirtyDaysAgo } },
          // Could also check for Search/Intent creation if relations allow efficient query
        ],
      },
    });

    const usersInFlow = await this.prisma.intent.count({
      where: { isInFlow: true },
    });

    // Verification Pending
    const pendingVerifications = await this.prisma.user.count({
      where: { status: 'VERIFICATION_PENDING' },
    });

    return {
      totalUsers,
      activeUsers,
      usersInFlow,
      pendingVerifications,
    };
  }

  async findAllUsers(
    search?: string,
    role?: string,
    status?: string,
    page?: number,
    limit: number = 20,
    cursor?: string,
  ) {
    const whereClause: any = { deletedAt: null };
    if (search) {
      whereClause.OR = [
        { mail: { contains: search, mode: 'insensitive' } },
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (role) {
      whereClause.role = role;
    }

    if (status) {
      whereClause.status = status;
    }

    const query: any = {
      where: whereClause,
      select: {
        id: true,
        uid: true,
        mail: true,
        firstName: true,
        lastName: true,
        role: true,
        status: true,
        isKycVerified: true,
        isActif: true,
        createdAt: true,
        identityProofs: {
          select: { url: true },
          take: 1,
          orderBy: { id: 'desc' },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
    };

    if (cursor) {
      query.cursor = { id: parseInt(cursor, 10) };
      query.skip = 1;
    } else if (page) {
      query.skip = (page - 1) * limit;
    }

    const items = await this.prisma.user.findMany(query);

    let hasMore = false;
    let nextCursor: string | undefined = undefined;

    if (items.length > limit) {
      hasMore = true;
      nextCursor = items[limit - 1].id.toString();
      items.pop();
    }

    const total = await this.prisma.user.count({ where: whereClause });

    return {
      items,
      total,
      hasMore,
      nextCursor,
    };
  }

  async getUserLogs(userId: number) {
    return this.prisma.connectionLog.findMany({
      where: { userId },
      orderBy: { loginDate: 'desc' },
      take: 20,
    });
  }

  async banUser(
    userId: number,
    data?: { reason?: string; customMessage?: string; template?: string },
  ) {
    const userExists = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!userExists) throw new NotFoundException('User not found');

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        isActif: false,
        isLocked: true,
        status: 'BANNED',
        isBanned: true,
        banReason: data?.reason || "Violation des conditions d'utilisation",
        banMessage: data?.customMessage,
        bannedAt: new Date(),
      },
    });

    // Send ban email
    try {
      const userName = user.firstName || user.mail;
      await this.mailService.sendBanEmail(
        user.mail,
        userName,
        data?.reason || 'Non respect de la charte de conduite',
        data?.customMessage || '',
        data?.template || 'user-banned',
      );
    } catch (error) {
      console.error('Failed to send ban email:', error);
    }

    // Notify user in real-time if connected
    this.chatGateway.notifyUserBanned(userId);

    return user;
  }

  async unbanUser(userId: number) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Utilisateur non trouvé');

    return this.prisma.user.update({
      where: { id: userId },
      data: {
        isActif: true,
        isLocked: false,
        status: 'VERIFIED',
        isBanned: false,
        banReason: null,
        banMessage: null,
        bannedAt: null,
      },
    });
  }

  // Verify User (Approve or Reject)
  async verifyUser(userId: number, approved: boolean, reason?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    if (approved) {
      // Approve
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          status: 'VERIFIED',
          isKycVerified: true,
          kycStatus: 'VERIFIED', // Ensure sync
          kycReason: null,
          //,
          //accountValidatedAt: new Date()
        },
      });
      // Send Approval Email
      console.log(
        `[verifyUser] Attempting to send approval email to ${user.mail}`,
      );
      try {
        await this.mailService.sendIdentityVerifiedEmail(
          user.mail,
          user.firstName,
        );
        console.log(
          `[verifyUser] Approval email sent successfully to ${user.mail}`,
        );
      } catch (err) {
        console.error(
          `[verifyUser] Failed to send approval email to ${user.mail}:`,
          err,
        );
      }
    } else {
      // Reject
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          status: 'REJECTED',
          isKycVerified: false,
          kycStatus: 'REJECTED', // Ensure sync
          kycReason: reason, // Save the reason
        },
      });
      // Send Rejection Email with reason
      console.log(
        `[verifyUser] Attempting to send rejection email to ${user.mail}. Reason: ${reason}`,
      );
      try {
        await this.mailService.sendIdentityVerificationRetryEmail(
          user.mail,
          user.firstName,
          reason,
        );
        console.log(
          `[verifyUser] Rejection email sent successfully to ${user.mail}`,
        );
      } catch (err) {
        console.error(
          `[verifyUser] Failed to send rejection email to ${user.mail}:`,
          err,
        );
      }
      console.log(`User ${userId} rejected. Reason: ${reason}`);
    }

    return { message: approved ? 'User verified' : 'User rejected' };
  }

  async refundUser(userId: number) {
    // Logic to trigger refund via Payment Provider (Stripe/PayPal)
    // For now, allow it to "simulate" a refund if needed
    console.log(`Simulating refund for User ${userId}`);

    // Log this action?
    return { message: 'Refund process initiated' };
  }

  // --- Influencers & Promo Codes ---

  async findAllInfluencers() {
    return this.prisma.influencer.findMany({
      where: {
        deletedAt: null,
      },
      include: {
        promoCodes: {
          where: {
            deletedAt: null,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createInfluencer(data: {
    firstName: string;
    lastName: string;
    email: string;
  }) {
    const influencer = await this.prisma.influencer.create({
      data: {
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email,
      },
    });

    // Send Welcome Email
    try {
      await this.mailService.sendInfluencerWelcomeEmail(
        influencer.email,
        influencer.firstName,
      );
    } catch (error) {
      console.error('Failed to send influencer welcome email', error);
    }

    return influencer;
  }

  async deleteInfluencer(id: number) {
    // Check for active codes
    const nothingToDo = false;

    // Count active codes that will be invalidated
    const activeCodesCount = await this.prisma.promoCode.count({
      where: {
        influencerId: id,
        isActive: true,
        validUntil: { gt: new Date() },
        deletedAt: null,
      },
    });

    // Soft delete influencer
    await this.prisma.influencer.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    // Soft delete associated promo codes?
    // REQUIREMENT: "la suppression d'influenceur affiche une popup pour notifier que tous ces codes toujours valides seront supprimés"
    // So we should indeed delete (disable) them.

    await this.prisma.promoCode.updateMany({
      where: { influencerId: id, deletedAt: null },
      data: {
        isActive: false,
        updatedAt: new Date(),
      },
    });

    return {
      message: 'Influencer deleted',
      invalidatedCodes: activeCodesCount,
    };
  }

  async getInfluencerDeletionImpact(id: number) {
    const activeCodesCount = await this.prisma.promoCode.count({
      where: {
        influencerId: id,
        isActive: true,
        validUntil: { gt: new Date() },
        deletedAt: null,
      },
    });
    return { activeCodesCount };
  }

  async findAllPromoCodes() {
    return this.prisma.promoCode.findMany({
      include: {
        influencer: {
          select: { firstName: true, lastName: true, email: true },
        },
      },
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createPromoCode(data: any) {
    throw new ForbiddenException(
      "La création de codes promo est désactivée. Utilisez les liens d'affiliation.",
    );
  }

  async deletePromoCode(id: number) {
    throw new ForbiddenException(
      'La suppression de codes promo est désactivée.',
    );
  }

  async updatePromoCode(id: number, data: any) {
    throw new ForbiddenException(
      'La modification de codes promo est désactivée.',
    );
  }

  async togglePromoCode(id: number) {
    throw new ForbiddenException(
      "L'activation/désactivation de codes promo est désactivée.",
    );
  }

  async sendInfluencerReport(id: number) {
    const influencer = await this.prisma.influencer.findUnique({
      where: { id },
      include: {
        promoCodes: {
          where: { deletedAt: null },
        },
      },
    });

    if (!influencer) throw new NotFoundException('Influencer not found');

    const totalUsage = influencer.promoCodes.reduce(
      (sum, promo) => sum + promo.currentUsageCount,
      0,
    );

    try {
      await this.mailService.sendInfluencerReportEmail(
        influencer.email,
        influencer.firstName,
        influencer.promoCodes,
        totalUsage,
      );
      return { message: 'Rapport envoyé avec succès' };
    } catch (error) {
      console.error(error);
      throw new Error("Erreur lors de l'envoi du rapport");
    }
  }

  async updateInfluencer(
    id: number,
    data: { firstName?: string; lastName?: string; email?: string },
  ) {
    return this.prisma.influencer.update({
      where: { id },
      data,
    });
  }

  // --- Reports & Moderation ---

  async findAllReports(showArchived: boolean = false) {
    const where: any = {};
    if (!showArchived) {
      where.status = 'PENDING';
    } else {
      where.status = {
        in: ['PENDING', 'ARCHIVED', 'RESOLVED', 'DISMISSED'],
      };
    }

    return this.prisma.report.findMany({
      where,
      include: {
        reporter: {
          select: { id: true, firstName: true, lastName: true, mail: true },
        },
        reportedUser: {
          select: { id: true, firstName: true, lastName: true, mail: true },
        },
        chat: {
          select: { id: true, type: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async archiveReport(id: number) {
    return this.prisma.report.update({
      where: { id },
      data: { status: 'ARCHIVED' },
    });
  }

  async getChatThread(chatId: number) {
    const messages = await this.prisma.message.findMany({
      where: { chatId },
      include: {
        sender: {
          select: { id: true, firstName: true, lastName: true },
        },
        images: true,
      },
      orderBy: { createdAt: 'asc' },
      take: 100, // Last 100 messages for moderation review
    });

    // Sign URLs for media
    return await Promise.all(
      messages.map(async (msg: any) => {
        // Priority 1: Images relation
        if (msg.images && msg.images.length > 0) {
          msg.images = await Promise.all(
            msg.images.map(async (img: any) => {
              if (!img.url.startsWith('http')) {
                try {
                  const signedUrl = await this.s3Service.getPublicUrl(img.url);
                  return { ...img, url: signedUrl };
                } catch (e) {
                  return img;
                }
              }
              return img;
            }),
          );
          // Set content to first image for UI backward compat
          msg.content = msg.images[0].url;
        }
        // Priority 2: Legacy IMAGE content (if still exists)
        else if (msg.type === 'IMAGE' && msg.content) {
          if (!msg.content.startsWith('http')) {
            try {
              const signedUrl = await this.s3Service.getPublicUrl(msg.content);
              msg.content = signedUrl;
            } catch (e) {
              console.error(`[AdminService] Failed to sign legacy image: `, e);
            }
          }
        }
        // Priority 3: File attachments
        else if (msg.type === 'FILE' && msg.fileUrl) {
          if (!msg.fileUrl.startsWith('http')) {
            try {
              const signedUrl = await this.s3Service.getPublicUrl(msg.fileUrl);
              msg.fileUrl = signedUrl;
            } catch (e) {
              console.error(`[AdminService] Failed to sign file: `, e);
            }
          }
        }
        return msg;
      }),
    );
  }

  // --- KYC Verifications (Dashboard Admin) ---

  async findKycVerifications(
    search?: string,
    status?: string,
    page: number = 1,
    limit: number = 20,
  ) {
    const skip = (page - 1) * limit;

    // Build where clause: only users who are NOT verified
    const whereClause: any = {
      deletedAt: null,
      isKycVerified: false, // Primary filter: not verified
    };

    // If a specific status is requested, filter by that exact status
    // Otherwise, exclude VERIFIED status (should already be excluded by isKycVerified: false)
    if (status) {
      whereClause.kycStatus = status as any;
    } else {
      // Extra safety: exclude VERIFIED status explicitly
      whereClause.kycStatus = { notIn: ['VERIFIED'] };
    }

    if (search) {
      whereClause.AND = [
        {
          OR: [
            { mail: { contains: search, mode: 'insensitive' } },
            { firstName: { contains: search, mode: 'insensitive' } },
            { lastName: { contains: search, mode: 'insensitive' } },
          ],
        },
      ];
    }

    console.log(
      '[findKycVerifications] whereClause:',
      JSON.stringify(whereClause, null, 2),
    );

    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where: whereClause,
        select: {
          id: true,
          uid: true,
          mail: true,
          firstName: true,
          lastName: true,
          kycStatus: true,
          kycReason: true,
          kycAttempts: true, // [Added]
          kycLastError: true, // [Added]
          diditSessionId: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { updatedAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.user.count({ where: whereClause }),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      debug: { whereClause },
    };
  }

  async sendKycClarification(userId: number, reason: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { mail: true, firstName: true, id: true, kycStatus: true },
    });

    if (!user) {
      throw new NotFoundException('Utilisateur non trouvé');
    }

    // Update the KYC reason in DB so it reflects the last manual clarification
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        kycReason: reason,
        status: 'REJECTED', // Force to a state that shows in the list if it was something else
        kycStatus: 'REJECTED',
      },
    });

    // Send email to user
    try {
      await this.mailService.sendIdentityVerificationRetryEmail(
        user.mail,
        user.firstName,
        reason,
      );
      return { success: true, message: 'Email de précision envoyé' };
    } catch (error) {
      console.error('Failed to send KYC clarification email:', error);
      throw new Error("Erreur lors de l'envoi de l'email");
    }
  }

  async resetUserKyc(userId: number, adminId: number) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Utilisateur non trouvé');

    return this.prisma.$transaction(async (tx) => {
      // 1. Reset user KYC fields
      const updatedUser = await tx.user.update({
        where: { id: userId },
        data: {
          kycStatus: 'UNVERIFIED',
          isKycVerified: false,
          kycAttempts: 0,
          kycReason: null,
          kycLastError: null,
          diditSessionId: null, // Optional: clear session ID to force a fresh start
        },
      });

      // 2. Log action in AuditLog
      await tx.auditLog.create({
        data: {
          entityType: 'User' as any, // Cast to any if AuditEntityType enum is strict/generated differently
          entityId: userId,
          userId: adminId, // The admin performing the action
          action: 'UPDATE',
          changedFields: {
            action: 'RESET_KYC',
            previousStatus: user.kycStatus,
            previousAttempts: user.kycAttempts,
          },
          source: 'http',
          requestId: 'admin-reset-kyc',
        },
      });

      return updatedUser;
    });
  }

  async getAuditLogs(page: number = 1, limit: number = 20) {
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        // Optional: include relations if we want admin names
        // But AuditLog doesn't currently relation back to User on 'userId' directly in schema provided Step 3309?
        // Wait, Schema Step 3309 says: "userId Int?" but no @relation.
        // We might need to manually fetch names or update schema.
        // For now, let's just return IDs.
      }),
      this.prisma.auditLog.count(),
    ]);

    // Enrich logs with Admin names if possible?
    // Let's do a quick enrichment manually to avoid schema changes for now if relation missing
    const userIds = [
      ...new Set(items.map((i) => i.userId).filter((id) => id !== null)),
    ];
    const usersMap: Record<number, any> = {};

    if (userIds.length > 0) {
      const users = await this.prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, firstName: true, lastName: true, mail: true },
      });
      users.forEach((u) => (usersMap[u.id] = u));
    }

    const enrichedItems = items.map((item) => ({
      ...item,
      admin: item.userId ? usersMap[item.userId] : null,
    }));

    return {
      items: enrichedItems,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  // ============================================
  // FINANCIAL STATISTICS
  // ============================================

  /**
   * Get comprehensive financial statistics with precise decimal calculations.
   * Uses Decimal.js for accurate financial math to avoid floating-point errors.
   */
  async getFinancialStats(): Promise<FinancialStats> {
    // Fetch all successful/partially refunded payments with their financial data
    const payments = await this.prisma.payment.findMany({
      where: {
        status: {
          in: ['SUCCEEDED', 'PARTIALLY_REFUNDED', 'REFUNDED'],
        },
      },
      select: {
        id: true,
        status: true,
        matchesInitial: true,
        matchesUsed: true,
        matchesRefunded: true,
        pricePerMatch: true,
        amountBase: true,
        amountTotal: true,
      },
    });

    // Use Decimal.js for precise calculations
    let totalRevenue = new Decimal(0);
    let earnedRevenue = new Decimal(0);
    let refundedRevenue = new Decimal(0);
    let pendingRevenue = new Decimal(0);

    let totalMatchesSold = 0;
    let totalMatchesUsed = 0;
    let totalMatchesRefunded = 0;

    let successfulPayments = 0;
    let refundedPayments = 0;
    let partiallyRefundedPayments = 0;

    for (const payment of payments) {
      const pricePerMatch = new Decimal(payment.pricePerMatch);

      // Count matches
      totalMatchesSold += payment.matchesInitial;
      totalMatchesUsed += payment.matchesUsed;
      totalMatchesRefunded += payment.matchesRefunded;

      // Calculate revenues precisely
      // Total revenue = amountBase (what we receive before fees are added to customer)
      totalRevenue = totalRevenue.plus(new Decimal(payment.amountBase));

      // Earned revenue = matchesUsed * pricePerMatch
      const earned = pricePerMatch.times(payment.matchesUsed);
      earnedRevenue = earnedRevenue.plus(earned);

      // Refunded revenue = matchesRefunded * pricePerMatch
      const refunded = pricePerMatch.times(payment.matchesRefunded);
      refundedRevenue = refundedRevenue.plus(refunded);

      // Pending revenue = (matchesInitial - matchesUsed - matchesRefunded) * pricePerMatch
      const pendingMatches =
        payment.matchesInitial - payment.matchesUsed - payment.matchesRefunded;
      const pending = pricePerMatch.times(pendingMatches);
      pendingRevenue = pendingRevenue.plus(pending);

      // Count payment statuses
      if (payment.status === 'SUCCEEDED') {
        successfulPayments++;
      } else if (payment.status === 'REFUNDED') {
        refundedPayments++;
      } else if (payment.status === 'PARTIALLY_REFUNDED') {
        partiallyRefundedPayments++;
      }
    }

    const totalMatchesPending =
      totalMatchesSold - totalMatchesUsed - totalMatchesRefunded;

    return {
      // Format to 2 decimal places for currency display
      totalRevenue: totalRevenue.toFixed(2),
      earnedRevenue: earnedRevenue.toFixed(2),
      refundedRevenue: refundedRevenue.toFixed(2),
      pendingRevenue: pendingRevenue.toFixed(2),
      totalMatchesSold,
      totalMatchesUsed,
      totalMatchesRefunded,
      totalMatchesPending,
      totalPayments: payments.length,
      successfulPayments,
      refundedPayments,
      partiallyRefundedPayments,
    };
  }

  /**
   * Get time series data for matches sold (from payments).
   * Uses Payment data with succeededAt date for grouping.
   * Aggregates by day, week, month, or year.
   */
  async getFinancialTimeSeries(
    period: TimeSeriesPeriod = 'day',
    startDate?: Date,
    endDate?: Date,
  ): Promise<TimeSeriesResponse> {
    const validPeriods: TimeSeriesPeriod[] = ['day', 'week', 'month', 'year'];
    if (!validPeriods.includes(period)) {
      throw new BadRequestException(
        `Invalid period.Must be one of: ${validPeriods.join(', ')} `,
      );
    }

    // Default date range based on period
    const now = new Date();
    if (!endDate) {
      endDate = now;
    }
    if (!startDate) {
      startDate = new Date(now);
      switch (period) {
        case 'day':
          startDate.setDate(startDate.getDate() - 30);
          break;
        case 'week':
          startDate.setDate(startDate.getDate() - 84); // 12 weeks
          break;
        case 'month':
          startDate.setMonth(startDate.getMonth() - 12);
          break;
        case 'year':
          startDate.setFullYear(startDate.getFullYear() - 5);
          break;
      }
    }

    // Fetch all successful payments in the date range
    // Use succeededAt or createdAt for payments, refundedAt for refunds
    const payments = await this.prisma.payment.findMany({
      where: {
        status: {
          in: ['SUCCEEDED', 'PARTIALLY_REFUNDED', 'REFUNDED'],
        },
        OR: [
          {
            succeededAt: {
              gte: startDate,
              lte: endDate,
            },
          },
          {
            succeededAt: null,
            createdAt: {
              gte: startDate,
              lte: endDate,
            },
          },
        ],
      },
      select: {
        id: true,
        matchesInitial: true,
        matchesUsed: true,
        matchesRefunded: true,
        pricePerMatch: true,
        createdAt: true,
        succeededAt: true,
        refundedAt: true,
        status: true,
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    // Group payments by period - for "used" we count matchesUsed at payment date
    // This shows when matches were purchased (and became available for use)
    const groupedData = new Map<
      string,
      {
        matchesSold: number;
        revenueSold: Decimal;
        matchesUsed: number;
        revenueUsed: Decimal;
        matchesRefunded: number;
        revenueRefunded: Decimal;
      }
    >();

    for (const payment of payments) {
      // Use succeededAt if available, otherwise fallback to createdAt
      const paymentDate = payment.succeededAt || payment.createdAt;

      const dateKey = this.getDateKey(paymentDate, period);
      const pricePerMatch = new Decimal(payment.pricePerMatch);

      if (!groupedData.has(dateKey)) {
        groupedData.set(dateKey, {
          matchesSold: 0,
          revenueSold: new Decimal(0),
          matchesUsed: 0,
          revenueUsed: new Decimal(0),
          matchesRefunded: 0,
          revenueRefunded: new Decimal(0),
        });
      }

      const entry = groupedData.get(dateKey)!;

      // Count matches sold (initial) at payment date
      entry.matchesSold += payment.matchesInitial;
      entry.revenueSold = entry.revenueSold.plus(
        pricePerMatch.times(payment.matchesInitial),
      );

      // Count matches used at payment date (these are the matches that have been consumed)
      entry.matchesUsed += payment.matchesUsed;
      entry.revenueUsed = entry.revenueUsed.plus(
        pricePerMatch.times(payment.matchesUsed),
      );
    }

    // Handle refunds separately - group by refundedAt date
    const refundedPayments = await this.prisma.payment.findMany({
      where: {
        status: {
          in: ['PARTIALLY_REFUNDED', 'REFUNDED'],
        },
        refundedAt: {
          gte: startDate,
          lte: endDate,
        },
      },
      select: {
        matchesRefunded: true,
        pricePerMatch: true,
        refundedAt: true,
      },
    });

    for (const payment of refundedPayments) {
      if (!payment.refundedAt || payment.matchesRefunded === 0) continue;

      const dateKey = this.getDateKey(payment.refundedAt, period);
      const pricePerMatch = new Decimal(payment.pricePerMatch);

      if (!groupedData.has(dateKey)) {
        groupedData.set(dateKey, {
          matchesSold: 0,
          revenueSold: new Decimal(0),
          matchesUsed: 0,
          revenueUsed: new Decimal(0),
          matchesRefunded: 0,
          revenueRefunded: new Decimal(0),
        });
      }

      const entry = groupedData.get(dateKey)!;
      entry.matchesRefunded += payment.matchesRefunded;
      entry.revenueRefunded = entry.revenueRefunded.plus(
        pricePerMatch.times(payment.matchesRefunded),
      );
    }

    // Fill in missing dates and convert to array
    const data: TimeSeriesDataPoint[] = [];
    let totalMatchesUsed = 0;
    let totalRevenueUsed = new Decimal(0);
    let totalMatchesRefunded = 0;
    let totalRevenueRefunded = new Decimal(0);

    const allDates = this.generateDateRange(startDate, endDate, period);

    for (const dateKey of allDates) {
      const entry = groupedData.get(dateKey) || {
        matchesSold: 0,
        revenueSold: new Decimal(0),
        matchesUsed: 0,
        revenueUsed: new Decimal(0),
        matchesRefunded: 0,
        revenueRefunded: new Decimal(0),
      };

      data.push({
        date: dateKey,
        matchesUsed: entry.matchesUsed,
        revenueUsed: entry.revenueUsed.toFixed(2),
        matchesRefunded: entry.matchesRefunded,
        revenueRefunded: entry.revenueRefunded.toFixed(2),
      });

      totalMatchesUsed += entry.matchesUsed;
      totalRevenueUsed = totalRevenueUsed.plus(entry.revenueUsed);
      totalMatchesRefunded += entry.matchesRefunded;
      totalRevenueRefunded = totalRevenueRefunded.plus(entry.revenueRefunded);
    }

    return {
      period,
      data,
      totals: {
        matchesUsed: totalMatchesUsed,
        revenueUsed: totalRevenueUsed.toFixed(2),
        matchesRefunded: totalMatchesRefunded,
        revenueRefunded: totalRevenueRefunded.toFixed(2),
      },
    };
  }

  /**
   * Get the date key for grouping based on period
   */
  private getDateKey(date: Date, period: TimeSeriesPeriod): string {
    const d = new Date(date);
    switch (period) {
      case 'day':
        return d.toISOString().split('T')[0]; // YYYY-MM-DD
      case 'week':
        // Get ISO week start (Monday)
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1);
        const weekStart = new Date(d.setDate(diff));
        return weekStart.toISOString().split('T')[0];
      case 'month':
        return `${d.getFullYear()} -${String(d.getMonth() + 1).padStart(2, '0')} `;
      case 'year':
        return String(d.getFullYear());
      default:
        return d.toISOString().split('T')[0];
    }
  }

  /**
   * Generate all date keys in the range
   */
  private generateDateRange(
    startDate: Date,
    endDate: Date,
    period: TimeSeriesPeriod,
  ): string[] {
    const dates: string[] = [];
    const current = new Date(startDate);

    while (current <= endDate) {
      dates.push(this.getDateKey(current, period));

      switch (period) {
        case 'day':
          current.setDate(current.getDate() + 1);
          break;
        case 'week':
          current.setDate(current.getDate() + 7);
          break;
        case 'month':
          current.setMonth(current.getMonth() + 1);
          break;
        case 'year':
          current.setFullYear(current.getFullYear() + 1);
          break;
      }
    }

    // Remove duplicates (for week grouping)
    return [...new Set(dates)];
  }
}
