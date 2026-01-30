import { Test, TestingModule } from '@nestjs/testing';
import { MatchingService } from './matching.service';
import { PrismaService } from '../prisma/prisma.service';

const mockPrismaService = {
  search: {
    findFirst: jest.fn(),
  },
  intent: {
    findMany: jest.fn(),
  },
};

describe('MatchingService', () => {
  let service: MatchingService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MatchingService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<MatchingService>(MatchingService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findMatchesForUser', () => {
    it('should return empty array if user has no search criteria', async () => {
      mockPrismaService.search.findFirst.mockResolvedValue(null);

      const result = await service.findMatchesForUser(1);
      expect(result).toEqual([]);
    });

    it('should return matches based on criteria', async () => {
      const mockSearch = {
        userId: 1,
        minRent: 500,
        maxRent: 1000,
        minRoomSurface: 20,
        maxRoomSurface: 50,
        minRoomNb: 1,
        maxRoomNb: 3,
        homeType: 'Apartment',
      };

      const mockMatches = [
        {
          id: 1,
          home: {
            id: 101,
            rent: 800,
            surface: 30,
            nbRooms: 2,
            homeType: 'Apartment',
            images: [],
          },
          user: {
            firstName: 'John',
          },
        },
      ];

      mockPrismaService.search.findFirst.mockResolvedValue(mockSearch);
      mockPrismaService.intent.findMany.mockResolvedValue(mockMatches);

      const result = await service.findMatchesForUser(1);
      expect(result).toEqual(mockMatches);
      expect(mockPrismaService.intent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            isInFlow: true,
            home: expect.objectContaining({
              rent: { gte: 500, lte: 1000 },
            }),
          }),
        }),
      );
    });
  });
});
