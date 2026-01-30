import { Test, TestingModule } from '@nestjs/testing';
import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Server } from 'socket.io';
import { NotificationService } from '../notification/notification.service';
import { RedisService } from '../redis/redis.service';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';

describe('ChatGateway', () => {
  let gateway: ChatGateway;

  const mockChatService = {
    getConversations: jest.fn().mockResolvedValue([]),
    isParticipant: jest.fn().mockResolvedValue(true),
    saveMessage: jest.fn(),
    getChatWithParticipants: jest.fn().mockResolvedValue({ id: 1, participants: [] }),
  };

  const mockJwtService = {
    verifyAsync: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn().mockReturnValue('mock_secret'),
  };

  const mockServer = {
    to: jest.fn().mockReturnThis(),
    emit: jest.fn(),
  };

  const mockNotificationService = {
    sendNotification: jest.fn(),
  };

  const mockRedisService = {
    hset: jest.fn(),
    del: jest.fn(),
    get: jest.fn(),
  };

  const mockMailService = {
    sendEmail: jest.fn(),
  };

  const mockPrismaService = {
    user: { findUnique: jest.fn() },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatGateway,
        { provide: ChatService, useValue: mockChatService },
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: NotificationService, useValue: mockNotificationService },
        { provide: RedisService, useValue: mockRedisService },
        { provide: MailService, useValue: mockMailService },
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    gateway = module.get<ChatGateway>(ChatGateway);
    gateway.server = mockServer as any;
  });

  it('should be defined', () => {
    expect(gateway).toBeDefined();
  });

  describe('notifyUserReported', () => {
    it('should log and not emit (feature disabled)', () => {
      gateway.notifyUserReported(123);
      expect(mockServer.to).not.toHaveBeenCalled();
    });
  });

  describe('broadcastNewMessage', () => {
    it('should emit newMessage event to the chat room and user rooms', async () => {
      const mockChat = { id: 456, participants: [{ userId: 123 }, { userId: 789 }] };
      const mockMsg = { id: 1, content: 'hello', senderId: 123 };

      await gateway.broadcastNewMessage(mockChat, mockMsg);

      expect(mockServer.to).toHaveBeenCalledWith(expect.arrayContaining(['chat_456', 'user_123', 'user_789']));
      expect(mockServer.emit).toHaveBeenCalledWith('newMessage', mockMsg);
    });
  });
});
