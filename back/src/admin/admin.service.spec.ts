import { Test, TestingModule } from '@nestjs/testing';
import { AdminService } from './admin.service';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { NotFoundException } from '@nestjs/common';
import { S3Service } from '../home/services/s3.service';
import { ChatGateway } from '../chat/chat.gateway';
import { MatchingPaymentsService } from '../matching/services/matching-payments.service';

describe('AdminService', () => {
  let service: AdminService;
  let prisma: PrismaService;
  let mailService: MailService;

  const mockPrisma = {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    report: {
      findMany: jest.fn(),
      update: jest.fn(),
    },
    message: {
      findMany: jest.fn(),
    },
  };

  const mockMailService = {
    sendBanEmail: jest.fn(),
    sendIdentityVerifiedEmail: jest.fn(),
    sendIdentityVerificationRetryEmail: jest.fn(),
    sendInfluencerWelcomeEmail: jest.fn(),
    sendInfluencerReportEmail: jest.fn(),
  };

  const mockS3Service = {
    getPublicUrl: jest.fn().mockResolvedValue('https://mock-url.com'),
    uploadFile: jest.fn(),
  };

  const mockChatGateway = {
    notifyUserBanned: jest.fn(),
  };

  const mockMatchingPaymentsService = {
    // Methods if needed
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: MailService, useValue: mockMailService },
        { provide: S3Service, useValue: mockS3Service },
        { provide: ChatGateway, useValue: mockChatGateway },
        { provide: MatchingPaymentsService, useValue: mockMatchingPaymentsService },
      ],
    }).compile();

    service = module.get<AdminService>(AdminService);
    prisma = module.get<PrismaService>(PrismaService);
    mailService = module.get<MailService>(MailService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('banUser', () => {
    const userId = 1;
    const banData = {
      reason: 'Spam',
      customMessage: 'Stop it',
      template: 'ban-spam',
    };

    it('should throw NotFoundException if user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(service.banUser(userId, banData)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should update user status and send ban email', async () => {
      const mockUser = {
        id: userId,
        firstName: 'John',
        mail: 'john@example.com',
      };
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.user.update.mockResolvedValue({ ...mockUser, isBanned: true });

      await service.banUser(userId, banData);

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: userId },
        data: expect.objectContaining({
          isBanned: true,
          banReason: banData.reason,
          banMessage: banData.customMessage,
        }),
      });

      expect(mailService.sendBanEmail).toHaveBeenCalledWith(
        mockUser.mail,
        mockUser.firstName,
        banData.reason,
        banData.customMessage,
        banData.template,
      );
    });
  });
});
