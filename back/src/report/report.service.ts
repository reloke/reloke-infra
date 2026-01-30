import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ChatGateway } from '../chat/chat.gateway';
import { ReportStatus } from '@prisma/client';

@Injectable()
export class ReportService {
  constructor(
    private prisma: PrismaService,
    private chatGateway: ChatGateway,
  ) {}

  async createReport(
    reporterId: number,
    data: {
      reportedUserId: number;
      chatId: number;
      reason?: string;
      description?: string;
    },
  ) {
    // Verify participation
    const chat = await this.prisma.chat.findUnique({
      where: { id: data.chatId },
      include: { participants: true },
    });

    if (!chat) throw new NotFoundException('Conversation introuvable');

    const isReporterIn = chat.participants.some((p) => p.userId === reporterId);
    const isReportedIn = chat.participants.some(
      (p) => p.userId === data.reportedUserId,
    );

    if (!isReporterIn || !isReportedIn) {
      throw new BadRequestException(
        'Les deux utilisateurs doivent être participants de la conversation',
      );
    }

    const report = await this.prisma.report.create({
      data: {
        reporterId,
        reportedUserId: data.reportedUserId,
        chatId: data.chatId,
        reason: data.reason,
        description: data.description,
        status: ReportStatus.PENDING,
      },
      include: {
        reportedUser: {
          select: { id: true, firstName: true },
        },
      },
    });

    // Real-time notification to the reported user
    this.chatGateway.notifyUserReported(data.reportedUserId);

    return report;
  }
}
