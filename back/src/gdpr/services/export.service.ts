import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { S3Service } from '../../home/services/s3.service';

@Injectable()
export class ExportService {
  private readonly logger = new Logger(ExportService.name);

  constructor(
    private prisma: PrismaService,
    private s3Service: S3Service,
  ) {}

  /**
   * Generates a comprehensive JSON export of user data
   */
  async exportUserData(userId: number): Promise<any> {
    this.logger.log(`Generating GDPR export for user ${userId}`);

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        metadata: true,
        // Include related data
        home: {
          include: { images: true },
        },
        searches: {
          include: { searchAdresses: true },
        },
        intents: {
          include: {
            matchesAsSeeker: true,
            matchesAsTarget: true,
          },
        },
        payments: {
          include: { transactions: true },
        },
        messages: {
          where: { isDeleted: false as boolean }, // Cast if TS complains about field existence before refresh
        },
        reportsMade: true,
        connectionLogs: {
          take: 100,
          orderBy: { loginDate: 'desc' },
        },
        notifications: {
          take: 100,
          orderBy: { createdAt: 'desc' },
        },
        dossierFacileLink: true, // New relation
      },
    });

    if (!user) {
      throw new Error('User not found');
    }

    // Clean up sensitive data
    const { password, resetPasswordToken, ...cleanUser } = user;

    // TODO: Generate signed URLs for S3 assets?
    // GDPR says "portability". Providing raw keys is maybe not enough if they can't access them.
    // Providing signed URLs (valid 1h) allows them to download immediately.

    // We will augment home images with signed URLs
    if (cleanUser.home && cleanUser.home.images) {
      for (const img of cleanUser.home.images) {
        try {
          (img as any).downloadUrl = await this.s3Service.getPublicUrl(img.url);
        } catch (e) {
          // ignore
        }
      }
    }

    return {
      _generatedAt: new Date(),
      _notice:
        'This export contains your personal data as stored in our systems.',
      user: cleanUser,
    };
  }
}
