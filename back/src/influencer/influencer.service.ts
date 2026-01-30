import {
  Injectable,
  NotFoundException,
  InternalServerErrorException,
  Logger,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { ConfigService } from '@nestjs/config';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class InfluencerService {
  private readonly logger = new Logger(InfluencerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
    private readonly configService: ConfigService,
  ) {}

  async generateInfluencerLink(id: number) {
    const influencer = await this.prisma.influencer.findUnique({
      where: { id, deletedAt: null },
    });

    if (!influencer) {
      throw new NotFoundException(`Influencer with ID ${id} not found`);
    }

    // Generate unique long token (UUID)
    const influencerHash = uuidv4();

    try {
      const updatedInfluencer = await this.prisma.influencer.update({
        where: { id },
        data: { influencerHash },
      });

      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:4200';
      return {
        id: updatedInfluencer.id,
        influencerHash: updatedInfluencer.influencerHash,
        registrationUrl: `${frontendUrl}/auth/register?f=${updatedInfluencer.influencerHash}`,
      };
    } catch (error) {
      if (error.code === 'P2002') {
        // Retry once if collision occurs (unlikely with UUID)
        return this.generateInfluencerLink(id);
      }
      this.logger.error(
        `Error generating link for influencer ${id}`,
        error.stack,
      );
      throw new InternalServerErrorException(
        'Could not generate influencer link',
      );
    }
  }

  async sendInfluencerLink(id: number) {
    const influencer = await this.prisma.influencer.findUnique({
      where: { id, deletedAt: null },
    });

    if (!influencer) {
      throw new NotFoundException(`Influencer with ID ${id} not found`);
    }

    if (!influencer.influencerHash) {
      throw new ConflictException('Influencer link has not been generated yet');
    }

    const frontendUrl =
      this.configService.get<string>('FRONTEND_URL') || 'http://localhost:4200';
    const registrationUrl = `${frontendUrl}/auth/register?f=${influencer.influencerHash}`;

    await this.mailService.sendInfluencerInviteEmail(
      influencer.email,
      influencer.firstName,
      registrationUrl,
    );

    return { success: true, message: 'Link sent to influencer' };
  }

  async getInfluencerInfoByHash(hash: string) {
    const influencer = await this.prisma.influencer.findUnique({
      where: { influencerHash: hash, deletedAt: null },
      select: {
        id: true,
        firstName: true,
        lastName: true,
      },
    });

    if (!influencer) {
      this.logger.warn(`Influencer not found for hash: ${hash}`);
      throw new NotFoundException('Influencer not found');
    }

    return influencer;
  }
}
