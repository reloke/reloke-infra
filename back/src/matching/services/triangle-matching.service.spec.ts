import { Test, TestingModule } from '@nestjs/testing';
import { TriangleMatchingService } from './triangle-matching.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MatchLogger } from './match-debug.types';
import { NotificationOutboxService } from './notification-outbox.service';
import { MatchingConfigService } from '../config/matching.config';

describe('TriangleMatchingService', () => {
  let service: TriangleMatchingService;
  let prismaService: PrismaService;
  let mockLogger: MatchLogger;

  const mockPrismaService = {
    intent: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    intentEdge: {
      upsert: jest.fn(),
      deleteMany: jest.fn(),
    },
    match: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    payment: {
      findMany: jest.fn(),
      update: jest.fn(),
    },
    $queryRaw: jest.fn(),
    safeTransaction: jest.fn(),
  };

  const mockNotificationOutboxService = {
    writeTriangleMatchOutbox: jest.fn(),
  };

  const mockMatchingConfigService = {
    candidateLimit: 200,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TriangleMatchingService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: NotificationOutboxService,
          useValue: mockNotificationOutboxService,
        },
        {
          provide: MatchingConfigService,
          useValue: mockMatchingConfigService,
        },
      ],
    }).compile();

    service = module.get<TriangleMatchingService>(TriangleMatchingService);
    prismaService = module.get<PrismaService>(PrismaService);

    // Create mock logger
    mockLogger = new MatchLogger();
    jest.spyOn(mockLogger, 'debug').mockImplementation();
    jest.spyOn(mockLogger, 'info').mockImplementation();
    jest.spyOn(mockLogger, 'logTransaction').mockImplementation();

    // Reset all mocks
    jest.clearAllMocks();
  });

  describe('findAndCreateTriangles', () => {
    it('should return 0 if seeker has no credits', async () => {
      mockPrismaService.intent.findUnique.mockResolvedValueOnce({
        id: 1,
        userId: 1,
        isInFlow: true,
        totalMatchesRemaining: 0,
        homeId: 1,
        searchId: 1,
        home: {
          id: 1,
          lat: 48.85,
          lng: 2.35,
          rent: 1000,
          surface: 50,
          nbRooms: 2,
          homeType: 'T2',
          addressFormatted: 'Paris',
        },
        search: { id: 1 },
        user: { firstName: 'Test', lastName: 'User' },
      });

      const result = await service.findAndCreateTriangles(1, 10, mockLogger);

      expect(result).toBe(0);
    });
  });
});
