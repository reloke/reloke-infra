import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { S3Service } from '../home/services/s3.service';

export interface UserHomeContext {
  hasHome: boolean;
  home?: {
    addressFormatted: string | null;
    homeType: string | null;
    nbRooms: number | null;
    surface: number | null;
    rent: number | null;
    description: string | null;
    imagesCount: number;
    imageUrls: string[];
  };
}

export interface UserSearchContext {
  hasSearch: boolean;
  search?: {
    minRent: number | null;
    maxRent: number | null;
    minRoomSurface: number | null;
    maxRoomSurface: number | null;
    minRoomNb: number | null;
    maxRoomNb: number | null;
    homeType: string[] | null;
    searchStartDate: Date | null;
    searchEndDate: Date | null;
    zones: { label: string | null }[];
  };
}

export interface UserCreditsContext {
  totalMatchesPurchased: number;
  totalMatchesUsed: number;
  totalMatchesRemaining: number;
  isInFlow: boolean;
  isActivelySearching: boolean;
  refundCooldownUntil: Date | null;
}

export interface UserMatchContext {
  matchUid: string;
  status: string;
  type: string;
  createdAt: Date;
  targetHome: {
    addressFormatted: string | null;
    homeType: string | null;
    rent: number | null;
    surface: number | null;
    nbRooms: number | null;
  };
}

export interface UserTransactionContext {
  id: number;
  type: string;
  status: string;
  amountTotal: number | null;
  currency: string;
  occurredAt: Date;
  paymentId: number | null;
}

export interface UserHelpRequestContext {
  uid: string;
  topic: string;
  status: string;
  createdAt: Date;
}

export interface UserFullContext {
  user: {
    id: number;
    uid: string;
    firstName: string;
    lastName: string;
    mail: string;
    createdAt: Date;
    isKycVerified: boolean;
    accountValidatedAt: Date | null;
    isBanned: boolean;
    banReason: string | null;
    kycStatus: string;
    role: string;
  };
  home: UserHomeContext;
  search: UserSearchContext;
  credits: UserCreditsContext;
  recentMatches: UserMatchContext[];
  recentTransactions: UserTransactionContext[];
  recentHelpRequests: UserHelpRequestContext[];
}

// Extended transaction with payment details
export interface TransactionWithPayment {
  id: number;
  type: string;
  status: string;
  amountBase: number | null;
  amountFees: number | null;
  amountTotal: number | null;
  currency: string;
  occurredAt: Date;
  stripeEventId: string | null;
  stripeObjectId: string | null;
  metadata: Record<string, unknown> | null;
  payment: {
    id: number;
    stripeCheckoutSessionId: string;
    stripePaymentIntentId: string | null;
    stripeChargeId: string | null;
    stripeRefundId: string | null;
    planType: string;
    matchesInitial: number;
    matchesUsed: number;
    matchesRefunded: number;
    amountBase: number;
    amountFees: number;
    amountTotal: number;
    status: string;
    createdAt: Date;
    succeededAt: Date | null;
    refundedAt: Date | null;
  } | null;
}

export interface PaginatedTransactions {
  items: TransactionWithPayment[];
  total: number;
  page?: number;
  limit: number;
  totalPages?: number;
  hasMore: boolean;
  nextCursor?: string;
}

// Match with full details for admin view
export interface MatchWithDetails {
  uid: string;
  status: string;
  type: string;
  createdAt: Date;
  updatedAt: Date;
  groupId: string | null;
  // Seeker (the user who got this match)
  seekerUser: {
    id: number;
    uid: string;
    firstName: string;
    lastName: string;
    mail: string;
  };
  // Target user (the other party in the match)
  targetUser: {
    id: number;
    uid: string;
    firstName: string;
    lastName: string;
    mail: string;
  };
  // Target home details with images
  targetHome: {
    addressFormatted: string | null;
    homeType: string | null;
    rent: number | null;
    surface: number | null;
    nbRooms: number | null;
    description: string | null;
    imageUrls: string[];
  };
  // Seeker's home (for context in exchange)
  seekerHome: {
    addressFormatted: string | null;
    homeType: string | null;
    rent: number | null;
    surface: number | null;
    nbRooms: number | null;
  } | null;
  // Triangle match data if applicable
  triangleMeta: {
    participants?: {
      A?: {
        intentId: number;
        userId: number;
        firstName: string;
        lastName: string;
        homeAddress: string;
      };
      B?: {
        intentId: number;
        userId: number;
        firstName: string;
        lastName: string;
        homeAddress: string;
      };
      C?: {
        intentId: number;
        userId: number;
        firstName: string;
        lastName: string;
        homeAddress: string;
      };
    };
    edgeEvaluations?: Record<string, unknown>;
  } | null;
  // Snapshot data for match criteria
  snapshot: Record<string, unknown> | null;
}

export interface PaginatedMatches {
  items: UserMatchContext[];
  total: number;
  page?: number;
  limit: number;
  totalPages?: number;
  hasMore: boolean;
  nextCursor?: string;
}

@Injectable()
export class AdminUserService {
  private readonly logger = new Logger(AdminUserService.name);

  constructor(
    private prisma: PrismaService,
    private s3Service: S3Service,
  ) {}

  /**
   * Get full user context for admin view
   */
  async getUserFullContext(userId: number): Promise<UserFullContext> {
    // Fetch all data in parallel
    const [
      user,
      home,
      search,
      intent,
      recentMatches,
      recentTransactions,
      recentHelpRequests,
    ] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          uid: true,
          firstName: true,
          lastName: true,
          mail: true,
          createdAt: true,
          isKycVerified: true,
          accountValidatedAt: true,
          isBanned: true,
          banReason: true,
          kycStatus: true,
          role: true,
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
          description: true,
          images: {
            select: { id: true, url: true },
            orderBy: { order: 'asc' },
          },
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
          minRoomNb: true,
          maxRoomNb: true,
          homeType: true,
          searchStartDate: true,
          searchEndDate: true,
          searchAdresses: {
            select: { label: true },
          },
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
        take: 10,
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
              surface: true,
              nbRooms: true,
            },
          },
        },
      }),
      this.prisma.transaction.findMany({
        where: { userId },
        orderBy: { occurredAt: 'desc' },
        take: 15,
        select: {
          id: true,
          type: true,
          status: true,
          amountTotal: true,
          currency: true,
          occurredAt: true,
          paymentId: true,
        },
      }),
      this.prisma.helpRequest.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          uid: true,
          topic: true,
          status: true,
          createdAt: true,
        },
      }),
    ]);

    if (!user) {
      throw new NotFoundException('Utilisateur non trouvé');
    }

    // Build home context with signed image URLs
    let homeContext: UserHomeContext = { hasHome: false };
    if (home) {
      const imageUrls: string[] = [];
      for (const img of home.images) {
        try {
          const url = await this.s3Service.getPublicUrl(img.url);
          imageUrls.push(url);
        } catch (error) {
          this.logger.warn(`Failed to get signed URL for home image ${img.id}`);
        }
      }

      homeContext = {
        hasHome: true,
        home: {
          addressFormatted: home.addressFormatted,
          homeType: home.homeType,
          nbRooms: home.nbRooms,
          surface: home.surface,
          rent: home.rent,
          description: home.description,
          imagesCount: home.images.length,
          imageUrls,
        },
      };
    }

    // Build search context
    let searchContext: UserSearchContext = { hasSearch: false };
    if (search) {
      searchContext = {
        hasSearch: true,
        search: {
          minRent: search.minRent,
          maxRent: search.maxRent,
          minRoomSurface: search.minRoomSurface,
          maxRoomSurface: search.maxRoomSurface,
          minRoomNb: search.minRoomNb,
          maxRoomNb: search.maxRoomNb,
          homeType: search.homeType as string[] | null,
          searchStartDate: search.searchStartDate,
          searchEndDate: search.searchEndDate,
          zones: search.searchAdresses.map((a) => ({
            label: a.label,
          })),
        },
      };
    }

    // Build credits context
    const creditsContext: UserCreditsContext = intent
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
    const matchesContext: UserMatchContext[] = recentMatches.map((m) => ({
      matchUid: m.uid,
      status: m.status,
      type: m.type,
      createdAt: m.createdAt,
      targetHome: {
        addressFormatted: m.targetHome.addressFormatted,
        homeType: m.targetHome.homeType,
        rent: m.targetHome.rent,
        surface: m.targetHome.surface,
        nbRooms: m.targetHome.nbRooms,
      },
    }));

    // Build transactions context
    const transactionsContext: UserTransactionContext[] =
      recentTransactions.map((t) => ({
        id: t.id,
        type: t.type,
        status: t.status,
        amountTotal: t.amountTotal,
        currency: t.currency || 'EUR',
        occurredAt: t.occurredAt,
        paymentId: t.paymentId,
      }));

    // Build help requests context
    const helpRequestsContext: UserHelpRequestContext[] =
      recentHelpRequests.map((h) => ({
        uid: h.uid,
        topic: h.topic,
        status: h.status,
        createdAt: h.createdAt,
      }));

    return {
      user: {
        id: user.id,
        uid: user.uid,
        firstName: user.firstName,
        lastName: user.lastName,
        mail: user.mail,
        createdAt: user.createdAt,
        isKycVerified: user.isKycVerified,
        accountValidatedAt: user.accountValidatedAt,
        isBanned: user.isBanned,
        banReason: user.banReason,
        kycStatus: user.kycStatus,
        role: user.role,
      },
      home: homeContext,
      search: searchContext,
      credits: creditsContext,
      recentMatches: matchesContext,
      recentTransactions: transactionsContext,
      recentHelpRequests: helpRequestsContext,
    };
  }

  /**
   * Get full user context by UID (secure version)
   */
  async getUserFullContextByUid(uid: string): Promise<UserFullContext> {
    const user = await this.prisma.user.findUnique({
      where: { uid },
      select: { id: true },
    });

    if (!user) {
      throw new NotFoundException('Utilisateur non trouvé');
    }

    return this.getUserFullContext(user.id);
  }

  /**
   * Get paginated transactions for a user with full payment details
   * Supports both page-based (desktop) and cursor-based (mobile) pagination
   */
  async getUserTransactionsPaginated(
    userUid: string,
    page?: number,
    limit = 10,
    cursor?: string,
  ): Promise<PaginatedTransactions> {
    // First, get the user ID from UID
    const user = await this.prisma.user.findUnique({
      where: { uid: userUid },
      select: { id: true },
    });

    if (!user) {
      throw new NotFoundException('Utilisateur non trouvé');
    }

    const userId = user.id;

    // Build query conditions
    const where = { userId };

    // Cursor-based pagination (mobile/infinite scroll)
    if (cursor) {
      const cursorId = parseInt(cursor, 10);
      if (isNaN(cursorId)) {
        throw new NotFoundException('Invalid cursor');
      }

      const transactions = await this.prisma.transaction.findMany({
        where: {
          ...where,
          id: { lt: cursorId },
        },
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        take: limit + 1, // Fetch one extra to check hasMore
        include: {
          payment: true,
        },
      });

      const hasMore = transactions.length > limit;
      const items = hasMore ? transactions.slice(0, -1) : transactions;

      return {
        items: items.map((t) => this.mapTransactionWithPayment(t)),
        total: 0, // Not calculated for cursor-based
        limit,
        hasMore,
        nextCursor: hasMore ? items[items.length - 1].id.toString() : undefined,
      };
    }

    // Page-based pagination (desktop)
    const pageNum = page || 1;
    const skip = (pageNum - 1) * limit;

    const [transactions, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        skip,
        take: limit,
        include: {
          payment: true,
        },
      }),
      this.prisma.transaction.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit);

    return {
      items: transactions.map((t) => this.mapTransactionWithPayment(t)),
      total,
      page: pageNum,
      limit,
      totalPages,
      hasMore: pageNum < totalPages,
    };
  }

  /**
   * Get detailed transaction info including payment and Stripe metadata
   */
  async getTransactionDetail(
    transactionId: number,
  ): Promise<TransactionWithPayment & { userId: number }> {
    const transaction = await this.prisma.transaction.findUnique({
      where: { id: transactionId },
      include: {
        payment: true,
      },
    });

    if (!transaction) {
      throw new NotFoundException('Transaction non trouvée');
    }

    return {
      ...this.mapTransactionWithPayment(transaction),
      userId: transaction.userId,
    };
  }

  /**
   * Map Prisma transaction to TransactionWithPayment interface
   */
  private mapTransactionWithPayment(transaction: {
    id: number;
    type: string;
    status: string;
    amountBase: number | null;
    amountFees: number | null;
    amountTotal: number | null;
    currency: string | null;
    occurredAt: Date;
    stripeEventId: string | null;
    stripeObjectId: string | null;
    metadata: unknown;
    payment: {
      id: number;
      stripeCheckoutSessionId: string;
      stripePaymentIntentId: string | null;
      stripeChargeId: string | null;
      stripeRefundId: string | null;
      planType: string;
      matchesInitial: number;
      matchesUsed: number;
      matchesRefunded: number;
      amountBase: number;
      amountFees: number;
      amountTotal: number;
      status: string;
      createdAt: Date;
      succeededAt: Date | null;
      refundedAt: Date | null;
    } | null;
  }): TransactionWithPayment {
    return {
      id: transaction.id,
      type: transaction.type,
      status: transaction.status,
      amountBase: transaction.amountBase,
      amountFees: transaction.amountFees,
      amountTotal: transaction.amountTotal,
      currency: transaction.currency || 'EUR',
      occurredAt: transaction.occurredAt,
      stripeEventId: transaction.stripeEventId,
      stripeObjectId: transaction.stripeObjectId,
      metadata: transaction.metadata as Record<string, unknown> | null,
      payment: transaction.payment
        ? {
            id: transaction.payment.id,
            stripeCheckoutSessionId:
              transaction.payment.stripeCheckoutSessionId,
            stripePaymentIntentId: transaction.payment.stripePaymentIntentId,
            stripeChargeId: transaction.payment.stripeChargeId,
            stripeRefundId: transaction.payment.stripeRefundId,
            planType: transaction.payment.planType,
            matchesInitial: transaction.payment.matchesInitial,
            matchesUsed: transaction.payment.matchesUsed,
            matchesRefunded: transaction.payment.matchesRefunded,
            amountBase: transaction.payment.amountBase,
            amountFees: transaction.payment.amountFees,
            amountTotal: transaction.payment.amountTotal,
            status: transaction.payment.status,
            createdAt: transaction.payment.createdAt,
            succeededAt: transaction.payment.succeededAt,
            refundedAt: transaction.payment.refundedAt,
          }
        : null,
    };
  }

  /**
   * Get paginated matches for a user
   * Supports both page-based (desktop) and cursor-based (mobile) pagination
   */
  async getUserMatchesPaginated(
    userUid: string,
    page?: number,
    limit = 10,
    cursor?: string,
  ): Promise<PaginatedMatches> {
    // First, get the user ID from UID
    const user = await this.prisma.user.findUnique({
      where: { uid: userUid },
      select: { id: true },
    });

    if (!user) {
      throw new NotFoundException('Utilisateur non trouvé');
    }

    const userId = user.id;

    // Build query conditions - matches where user is the seeker
    const where = {
      seekerIntent: { userId },
    };

    // Cursor-based pagination (mobile/infinite scroll)
    if (cursor) {
      const matches = await this.prisma.match.findMany({
        where: {
          ...where,
          uid: { lt: cursor },
        },
        orderBy: [{ createdAt: 'desc' }, { uid: 'desc' }],
        take: limit + 1,
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
              surface: true,
              nbRooms: true,
            },
          },
        },
      });

      const hasMore = matches.length > limit;
      const items = hasMore ? matches.slice(0, -1) : matches;

      return {
        items: items.map((m) => ({
          matchUid: m.uid,
          status: m.status,
          type: m.type,
          createdAt: m.createdAt,
          targetHome: {
            addressFormatted: m.targetHome.addressFormatted,
            homeType: m.targetHome.homeType,
            rent: m.targetHome.rent,
            surface: m.targetHome.surface,
            nbRooms: m.targetHome.nbRooms,
          },
        })),
        total: 0,
        limit,
        hasMore,
        nextCursor: hasMore ? items[items.length - 1].uid : undefined,
      };
    }

    // Page-based pagination (desktop)
    const pageNum = page || 1;
    const skip = (pageNum - 1) * limit;

    const [matches, total] = await Promise.all([
      this.prisma.match.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { uid: 'desc' }],
        skip,
        take: limit,
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
              surface: true,
              nbRooms: true,
            },
          },
        },
      }),
      this.prisma.match.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit);

    return {
      items: matches.map((m) => ({
        matchUid: m.uid,
        status: m.status,
        type: m.type,
        createdAt: m.createdAt,
        targetHome: {
          addressFormatted: m.targetHome.addressFormatted,
          homeType: m.targetHome.homeType,
          rent: m.targetHome.rent,
          surface: m.targetHome.surface,
          nbRooms: m.targetHome.nbRooms,
        },
      })),
      total,
      page: pageNum,
      limit,
      totalPages,
      hasMore: pageNum < totalPages,
    };
  }

  /**
   * Get detailed match info including users, homes, and snapshot data
   */
  async getMatchDetail(matchUid: string): Promise<MatchWithDetails> {
    const match = await this.prisma.match.findUnique({
      where: { uid: matchUid },
      include: {
        seekerIntent: {
          include: {
            user: true,
          },
        },
        targetIntent: {
          include: {
            user: true,
          },
        },
        targetHome: {
          include: {
            images: {
              orderBy: { order: 'asc' },
            },
          },
        },
      },
    });

    if (!match) {
      throw new NotFoundException('Match non trouvé');
    }

    // Get seeker's home for context
    const seekerHome = await this.prisma.home.findUnique({
      where: { userId: match.seekerIntent.userId },
      select: {
        addressFormatted: true,
        homeType: true,
        rent: true,
        surface: true,
        nbRooms: true,
      },
    });

    // Get signed URLs for target home images
    const imageUrls: string[] = [];
    for (const img of match.targetHome.images) {
      try {
        const url = await this.s3Service.getPublicUrl(img.url);
        imageUrls.push(url);
      } catch (error) {
        this.logger.warn(`Failed to get signed URL for match image`);
      }
    }

    // Parse snapshot - triangleMeta is stored inside snapshot for triangle matches
    const snapshot = match.snapshot as Record<string, unknown> | null;
    // Extract triangle metadata from snapshot if present
    const triangleMeta = snapshot?.participants
      ? (snapshot as MatchWithDetails['triangleMeta'])
      : null;

    return {
      uid: match.uid,
      status: match.status,
      type: match.type,
      createdAt: match.createdAt,
      updatedAt: match.updatedAt,
      groupId: match.groupId,
      seekerUser: {
        id: match.seekerIntent.user.id,
        uid: match.seekerIntent.user.uid,
        firstName: match.seekerIntent.user.firstName,
        lastName: match.seekerIntent.user.lastName,
        mail: match.seekerIntent.user.mail,
      },
      targetUser: {
        id: match.targetIntent.user.id,
        uid: match.targetIntent.user.uid,
        firstName: match.targetIntent.user.firstName,
        lastName: match.targetIntent.user.lastName,
        mail: match.targetIntent.user.mail,
      },
      targetHome: {
        addressFormatted: match.targetHome.addressFormatted,
        homeType: match.targetHome.homeType,
        rent: match.targetHome.rent,
        surface: match.targetHome.surface,
        nbRooms: match.targetHome.nbRooms,
        description: match.targetHome.description,
        imageUrls,
      },
      seekerHome: seekerHome
        ? {
            addressFormatted: seekerHome.addressFormatted,
            homeType: seekerHome.homeType,
            rent: seekerHome.rent,
            surface: seekerHome.surface,
            nbRooms: seekerHome.nbRooms,
          }
        : null,
      triangleMeta,
      snapshot,
    };
  }
}
