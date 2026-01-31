import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';

@Injectable()
export class PromosService {
  constructor(
    private prisma: PrismaService,
    private mailService: MailService,
  ) { }

  /**
   * READ-ONLY check for UI feedback.
   */
  async validatePromoCode(code: string) {
    const promo = await this.prisma.promoCode.findUnique({
      where: { code: code.toUpperCase() },
      include: { influencer: true },
    });

    if (!promo || promo.deletedAt) {
      throw new NotFoundException('Code promo introuvable.');
    }

    if (!promo.isActive) {
      throw new BadRequestException('Ce code promo est inactif.');
    }

    if (new Date() > promo.validUntil) {
      throw new BadRequestException('Ce code promo a expiré.');
    }

    if (
      promo.usageLimit !== null &&
      promo.currentUsageCount >= promo.usageLimit
    ) {
      throw new ConflictException(
        "La limite d'utilisation de ce code est atteinte.",
      );
    }

    return {
      code: promo.code,
      discountPercentage: promo.discountPercentage,
      influencerName: `${promo.influencer.firstName} ${promo.influencer.lastName}`,
    };
  }

  /**
   * ATOMIC application of promo code.
   * Handles concurrency to prevent race conditions exceeding usage limits.
   */
  async applyPromoCodeToUser(userId: number, code: string) {
    const normalizedCode = code.toUpperCase();

    return this.prisma.safeTransaction(async (tx) => {
      // 1. Check if user already used a code (Optional business rule: one code per user)
      const user = await tx.user.findUnique({ where: { id: userId } });

      if (!user) {
        throw new NotFoundException('Utilisateur introuvable.');
      }

      // Note: If you see a type error here, run 'npx prisma generate'
      if (user.usedPromoCodeId) {
        throw new BadRequestException('Vous avez déjà utilisé un code promo.');
      }

      // 2. Validate existence and basic state
      const promo = await tx.promoCode.findUnique({
        where: { code: normalizedCode },
      });

      if (
        !promo ||
        promo.deletedAt ||
        !promo.isActive ||
        new Date() > promo.validUntil
      ) {
        throw new BadRequestException('Code promo invalide ou expiré.');
      }

      // 3. ATOMIC LIMIT CHECK & INCREMENT
      // We assume strict checking. If usageLimit is null, we skip the limit check.
      // The updateMany is used here to assert the condition atomically in the DB query.
      // 3. ATOMIC LIMIT CHECK & INCREMENT
      // We dynamicly build the where clause to avoid TS errors with null values
      const whereClause: any = { id: promo.id };
      if (promo.usageLimit !== null) {
        whereClause.currentUsageCount = { lt: promo.usageLimit };
      }

      const updateResult = await tx.promoCode.updateMany({
        where: whereClause,
        data: {
          currentUsageCount: { increment: 1 },
        },
      });

      if (updateResult.count === 0) {
        // This means the WHERE clause failed (limit reached between read and write)
        throw new ConflictException(
          "Désolé, la limite de ce code vient d'être atteinte.",
        );
      }

      // 4. Link User
      await tx.user.update({
        where: { id: userId },
        data: { usedPromoCodeId: promo.id },
      });

      // 5. Notify Influencer
      // Note: In Sandbox mode, this will only go to verified emails (support@reloke.com) as configured in MailService
      // This call should be non-blocking in a real production environment (e.g., via Events) which we simulate here by not awaiting

      // We need to fetch influencer details as they weren't in the updateMany result
      const influencer = await tx.influencer.findUnique({
        where: { id: promo.influencerId },
      });

      if (influencer) {
        this.mailService
          .sendEmail({
            to: influencer.email,
            subject: 'Nouveau filleul ! 🚀',
            template: 'influencer-notification',
            context: {
              influencerFirstName: influencer.firstName,
              code: promo.code,
              currentUsageCount: promo.currentUsageCount + 1, // +1 because we just incremented
              dashboardUrl: 'https://reloke.com/influencer/dashboard', // Placeholder
            },
          })
          .catch((err) =>
            console.error('Failed to send influencer notification', err),
          );
      }

      return { success: true, discount: promo.discountPercentage };
    });
  }
}
