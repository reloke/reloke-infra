import { Test, TestingModule } from '@nestjs/testing';
import { PromosService } from './promos.service';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import {
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';

describe('PromosService', () => {
  let service: PromosService;
  let prisma: PrismaService;

  const mockPrisma = {
    promoCode: {
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    influencer: {
      findUnique: jest.fn(),
    },
    safeTransaction: jest.fn((callback) => callback(mockPrisma)),
  };

  const mockMail = {
    sendEmail: jest.fn().mockResolvedValue(true),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PromosService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: MailService, useValue: mockMail },
      ],
    }).compile();

    service = module.get<PromosService>(PromosService);
    prisma = module.get<PrismaService>(PrismaService);
    jest.clearAllMocks();
  });

  describe('validatePromoCode', () => {
    it('should throw NotFound if code does not exist', async () => {
      mockPrisma.promoCode.findUnique.mockResolvedValue(null);
      await expect(service.validatePromoCode('INVALID')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequest if code is inactive', async () => {
      mockPrisma.promoCode.findUnique.mockResolvedValue({
        code: 'INACTIVE',
        isActive: false,
        deletedAt: null,
      });
      await expect(service.validatePromoCode('INACTIVE')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequest if code is expired', async () => {
      mockPrisma.promoCode.findUnique.mockResolvedValue({
        code: 'EXPIRED',
        isActive: true,
        validUntil: new Date(Date.now() - 1000),
        deletedAt: null,
      });
      await expect(service.validatePromoCode('EXPIRED')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should return promo info if valid', async () => {
      mockPrisma.promoCode.findUnique.mockResolvedValue({
        code: 'VALID',
        isActive: true,
        validUntil: new Date(Date.now() + 100000),
        discountPercentage: 10,
        currentUsageCount: 0,
        usageLimit: 100,
        deletedAt: null,
        influencer: { firstName: 'Jeff', lastName: 'Bezos' },
      });
      const res = await service.validatePromoCode('VALID');
      expect(res.code).toBe('VALID');
      expect(res.discountPercentage).toBe(10);
    });
  });

  describe('applyPromoCodeToUser', () => {
    it('should throw ConflictException if limit reached during update', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 1,
        usedPromoCodeId: null,
      });
      mockPrisma.promoCode.findUnique.mockResolvedValue({
        id: 1,
        code: 'LIMIT',
        isActive: true,
        validUntil: new Date(Date.now() + 100000),
        usageLimit: 10,
        currentUsageCount: 10,
      });
      mockPrisma.promoCode.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.applyPromoCodeToUser(1, 'LIMIT')).rejects.toThrow(
        ConflictException,
      );
    });
  });
});
