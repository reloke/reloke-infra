import { Test, TestingModule } from '@nestjs/testing';
import { ReportService } from './report.service';
import { PrismaService } from '../prisma/prisma.service';
import { ChatGateway } from '../chat/chat.gateway';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { ReportStatus } from '@prisma/client';

describe('ReportService', () => {
  let service: ReportService;
  let prisma: PrismaService;
  let gateway: ChatGateway;

  const mockPrisma = {
    chat: {
      findUnique: jest.fn(),
    },
    report: {
      create: jest.fn(),
    },
  };

  const mockGateway = {
    notifyUserReported: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ChatGateway, useValue: mockGateway },
      ],
    }).compile();

    service = module.get<ReportService>(ReportService);
    prisma = module.get<PrismaService>(PrismaService);
    gateway = module.get<ChatGateway>(ChatGateway);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createReport', () => {
    const reporterId = 1;
    const reportedUserId = 2;
    const chatId = 10;
    const reportData = {
      reportedUserId,
      chatId,
      reason: 'Spam',
      description: 'Annoying messages',
    };

    it('should throw NotFoundException if chat does not exist', async () => {
      mockPrisma.chat.findUnique.mockResolvedValue(null);

      await expect(
        service.createReport(reporterId, reportData),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if reporter is not in chat', async () => {
      mockPrisma.chat.findUnique.mockResolvedValue({
        id: chatId,
        participants: [{ userId: reportedUserId }], // Reporter missing
      });

      await expect(
        service.createReport(reporterId, reportData),
      ).rejects.toThrow(BadRequestException);
    });

    it('should create a report and notify the user', async () => {
      const mockChat = {
        id: chatId,
        participants: [{ userId: reporterId }, { userId: reportedUserId }],
      };
      const mockReport = {
        id: 100,
        ...reportData,
        status: ReportStatus.PENDING,
      };

      mockPrisma.chat.findUnique.mockResolvedValue(mockChat);
      mockPrisma.report.create.mockResolvedValue(mockReport);

      const result = await service.createReport(reporterId, reportData);

      expect(result).toEqual(mockReport);
      expect(mockPrisma.report.create).toHaveBeenCalledWith({
        data: {
          reporterId,
          reportedUserId,
          chatId,
          reason: 'Spam',
          description: 'Annoying messages',
          status: ReportStatus.PENDING,
        },
        include: {
          reportedUser: { select: { id: true, firstName: true } },
        },
      });
      expect(gateway.notifyUserReported).toHaveBeenCalledWith(reportedUserId);
    });
  });
});
