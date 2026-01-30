import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { MailService } from '../mail/mail.service';
import { RedisService } from '../redis/redis.service';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';

jest.mock('bcrypt', () => ({
  hash: jest.fn().mockResolvedValue('hashedPassword'),
  compare: jest.fn().mockResolvedValue(true),
}));

describe('AuthService', () => {
  let service: AuthService;
  let prisma: PrismaService;
  let redis: RedisService;
  let mail: MailService;

  const mockPrisma = {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
    connectionLog: {
      create: jest.fn(),
    },
  };

  const mockRedis = {
    incr: jest.fn().mockResolvedValue(1),
    setExpire: jest.fn(),
    hgetall: jest.fn().mockResolvedValue({}),
    hset: jest.fn(),
    hincrby: jest.fn().mockResolvedValue(1),
    del: jest.fn(),
  };

  const mockMail = {
    sendVerificationEmail: jest.fn(),
    sendWelcomeEmail: jest.fn(),
  };

  const mockJwt = {
    sign: jest.fn().mockReturnValue('mock_token'),
    verify: jest
      .fn()
      .mockReturnValue({ email: 'test@example.com', verified: true }),
    verifyAsync: jest.fn().mockResolvedValue({ sub: 1 }),
  };

  const mockConfig = {
    get: jest.fn().mockReturnValue('mock_secret'),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: RedisService, useValue: mockRedis },
        { provide: MailService, useValue: mockMail },
        { provide: JwtService, useValue: mockJwt },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    prisma = module.get<PrismaService>(PrismaService);
    redis = module.get<RedisService>(RedisService);
    mail = module.get<MailService>(MailService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('initiateRegister', () => {
    it('should send email if user does not exist', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      const result = await service.initiateRegister(
        {
          email: 'new@example.com',
          verificationToken: 'captcha_token',
        },
        '127.0.0.1',
      );
      expect(result.message).toBeDefined();
      expect(mail.sendVerificationEmail).toHaveBeenCalled();
    });
  });

  describe('register', () => {
    it('should create user if token is valid', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({
        id: 1,
        mail: 'test@example.com',
        firstName: 'John',
      });

      const result = await service.register(
        {
          registrationToken: 'valid_token',
          password: 'password123',
          firstName: 'John',
          lastName: 'Doe',
          cguAccepted: true,
        },
        '127.0.0.1',
      );

      expect(result.user).toBeDefined();
      expect(mail.sendWelcomeEmail).toHaveBeenCalled();
    });
  });
});
