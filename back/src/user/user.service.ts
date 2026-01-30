import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as ExcelJS from 'exceljs';
import type { Response } from 'express';
import { randomUUID } from 'crypto';
import { MailService } from '../mail/mail.service';
import { MatchingPaymentsService } from '../matching/services/matching-payments.service';
import { RefundResponseDto } from '../matching/dto/matching-payments.dto';

@Injectable()
export class UserService {
  constructor(
    private prisma: PrismaService,
    private mailService: MailService,
    private matchingPaymentsService: MatchingPaymentsService,
  ) { }

  // 1. Update Profile (Name)
  async updateProfile(
    userId: number,
    data: { firstName: string; lastName: string },
  ) {
    // Check if validated
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Utilisateur non trouvé');

    if (user.isKycVerified) {
      throw new ForbiddenException(
        "Impossible de modifier le nom car l'identité est validée.",
      );
    }

    return this.prisma.user.update({
      where: { id: userId },
      data: {
        firstName: data.firstName,
        lastName: data.lastName,
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        mail: true,
        updatedAt: true,
      },
    });
  }

  // 1.2 Update Push Settings
  async updatePushSettings(userId: number, pushEnabled: boolean) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { pushEnabled },
      select: {
        id: true,
        pushEnabled: true,
      },
    });
  }

  // 2. Upload Identity Proof
  async uploadIdentityProof(userId: number, file: any) {
    // Using any to bypass global namespace issues promptly
    // In a real app, upload to S3/Cloudinary here.
    // For now, we assume the file is saved locally via Multer Destination,
    // and we store the path/filename.

    const fileUrl = file.path; // Or construct a public URL if served statically

    // Save record in DB
    await this.prisma.identityProof.create({
      data: {
        url: fileUrl,
        userId: userId,
      },
    });

    // Update User status
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        status: 'VERIFICATION_PENDING', // Ensure this status exists or use a variable
      },
    });

    return { message: 'Identity proof uploaded successfully' };
  }

  // 3. Export User Data (Excel)
  async exportUserData(userId: number, res: Response) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        metadata: true,
        intents: true,
        searches: true,
      },
    });

    if (!user) throw new NotFoundException('User not found');

    const workbook = new ExcelJS.Workbook();

    // Sheet 1: Personal Info
    const infoSheet = workbook.addWorksheet('Personal Info');
    infoSheet.columns = [
      { header: 'ID', key: 'id', width: 10 },
      { header: 'First Name', key: 'firstName', width: 20 },
      { header: 'Last Name', key: 'lastName', width: 20 },
      { header: 'Email', key: 'mail', width: 30 },
      { header: 'Created At', key: 'createdAt', width: 20 },
      { header: 'Last Connection', key: 'dateLastConnection', width: 20 },
    ];
    infoSheet.addRow({
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      mail: user.mail,
      createdAt: user.createdAt,
      dateLastConnection: user.dateLastConnection,
    });

    // Sheet 2: Activity Logs (Example with Searches)
    const activitySheet = workbook.addWorksheet('Activity');
    activitySheet.columns = [
      { header: 'Type', key: 'type', width: 15 },
      { header: 'Date', key: 'date', width: 20 },
      { header: 'Details', key: 'details', width: 50 },
    ];

    user.searches.forEach((search) => {
      activitySheet.addRow({
        type: 'Search',
        date: '', // Search doesn't have createdAt in current schema shown?
        details: `Rent: ${search.minRent}-${search.maxRent}, Type: ${search.homeType}`,
      });
    });

    // Set Response Headers
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename=' + `user_data_${userId}.xlsx`,
    );

    await workbook.xlsx.write(res);
    res.end();
  }

  // 4. Request Account Deletion (Grace Period)
  async requestDeletion(userId: number) {
    // 1. Pre-check for credits/intents
    const precheck = await this.getDeletionPrecheck(userId);
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Utilisateur non trouvé');

    // 2. Automated Refund Request (if credits available)
    let refundResult: RefundResponseDto | null = null;
    if (precheck.hasCredits) {
      try {
        refundResult = await this.matchingPaymentsService.requestRefund(userId);
      } catch (err) {
        console.error(
          `[UserService] Automatic refund failed for user ${userId} during deletion request:`,
          err,
        );
        // We continue deletion even if refund fails, but log it.
      }
    }

    const scheduledDate = new Date();
    scheduledDate.setDate(scheduledDate.getDate() + 30); // Grace period: J+30

    // 3. Update User Status
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        deletionScheduledAt: scheduledDate,
        deletionRequestedAt: new Date(),
        deletedAt: null,
        isActif: false, // Deactivate profile
        marketingConsent: false, // Disable marketing
        pushEnabled: false, // Disable push
        tokenVersion: { increment: 1 }, // Invalidate other sessions
      },
    });

    // 4. Ensure user is removed from matching flow
    // Deactivate ALL intents for this user
    await this.prisma.intent.updateMany({
      where: { userId },
      data: { isInFlow: false, isActivelySearching: false },
    });

    // 5. Send Confirmation Email
    await this.mailService.sendDeletionRequestEmail(
      user.mail,
      user.firstName || 'Utilisateur',
      scheduledDate,
      precheck.isInFlow,
      refundResult?.success || false,
      refundResult?.matchesRefunded || 0,
      refundResult?.refundedAmount || 0,
    );

    return {
      message:
        'Demande de suppression prise en compte. Votre compte sera anonymisé dans 30 jours.',
      refundTriggered: precheck.hasCredits,
      refundSuccess: refundResult?.success,
      scheduledDate,
    };
  }

  async getDeletionPrecheck(userId: number) {
    try {
      const summary =
        await this.matchingPaymentsService.getMatchingSummary(userId);
      return {
        isInFlow: summary.isInFlow,
        hasCredits: summary.totalMatchesRemaining > 0,
        remainingCredits: summary.totalMatchesRemaining,
      };
    } catch (err) {
      // If matching service fails (e.g. no intent created yet), return defaults
      return {
        isInFlow: false,
        hasCredits: false,
        remainingCredits: 0,
      };
    }
  }

  // 5. Cancel Account Deletion
  async cancelDeletion(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) throw new NotFoundException('User not found');

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        deletionScheduledAt: null,
        deletionRequestedAt: null,
        deletedAt: null,
        isActif: true,
        marketingConsent: true,
        pushEnabled: true,
      },
    });

    return {
      message: 'Procédure de suppression annulée. Votre compte a été restauré.',
    };
  }

  // 6. Update KYC status (Didit)
  async updateKycStatus(userId: number, status: string, sessionId?: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        kycStatus: status as any,
        diditSessionId: sessionId || undefined,
      },
    });
  }

  // 7. Success logic for verified identity (Didit)
  async validateIdentity(userId: number, sessionId: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        kycStatus: 'VERIFIED' as any,
        diditSessionId: sessionId,
        isKycVerified: true,
        accountValidatedAt: new Date(),
      },
    });
  }

  async findOne(id: number) {
    return this.prisma.user.findUnique({
      where: { id },
      include: {
        usedPromoCode: true,
        influencer: true,
      },
    });
  }

  async findByMail(email: string) {
    return this.prisma.user.findUnique({
      where: { mail: email },
    });
  }
}
