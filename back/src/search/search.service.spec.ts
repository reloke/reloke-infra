import { Test, TestingModule } from '@nestjs/testing';
import { SearchService } from './search.service';
import { PrismaService } from '../prisma/prisma.service';
import { BadRequestException } from '@nestjs/common';
import { S3Service } from '../home/services/s3.service';
import { SearchMaintenanceService } from './search-maintenance.service';

describe('SearchService', () => {
  let service: SearchService;
  let maintenance: SearchMaintenanceService;

  const mockPrisma = {
    search: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    searchAdress: {
      createMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    intent: {
      findFirst: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
    $transaction: jest.fn((callback: any) => callback(mockPrisma)),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SearchService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: S3Service, useValue: { deleteFiles: jest.fn() } },
        {
          provide: SearchMaintenanceService,
          useValue: {
            stopAndCleanupUsers: jest.fn().mockResolvedValue({
              matchesArchived: 0,
              searchAdressesDeleted: 0,
              homeImgsDeleted: 0,
              usersProcessed: 1,
              s3KeysAttempted: 0,
            }),
            cleanupUsersWithClient: jest.fn(),
            deleteKeysSafe: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<SearchService>(SearchService);
    maintenance = module.get<SearchMaintenanceService>(
      SearchMaintenanceService,
    );
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-01-23T10:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const callValidate = (dto: any) => (service as any).validateSearchData(dto);

  it('rejects end date before start date', () => {
    const dto = {
      searchStartDate: '2026-01-25',
      searchEndDate: '2026-01-24',
      zones: [],
    };
    expect(() => callValidate(dto)).toThrow(BadRequestException);
  });

  it('rejects past start date based on client timezone', () => {
    const dto = {
      searchStartDate: '2026-01-22',
      searchEndDate: '2026-01-24',
      zones: [],
      clientTimeZone: 'UTC',
    };
    expect(() => callValidate(dto)).toThrow(BadRequestException);
  });

  it('accepts today when client is ahead in timezone (+14)', () => {
    const dto = {
      searchStartDate: '2026-01-24',
      searchEndDate: '2026-01-24',
      zones: [],
      clientTimeZone: 'Pacific/Kiritimati',
    };
    expect(() => callValidate(dto)).not.toThrow();
  });

  it('rejects minRent greater than maxRent', () => {
    const dto = {
      searchStartDate: '2026-01-24',
      searchEndDate: '2026-01-25',
      minRent: 1000,
      maxRent: 500,
      zones: [],
    };
    expect(() => callValidate(dto)).toThrow(BadRequestException);
  });

  it('stopSearch archives and cleans via maintenance service', async () => {
    (maintenance.stopAndCleanupUsers as jest.Mock).mockResolvedValue({
      matchesArchived: 2,
      searchAdressesDeleted: 3,
      homeImgsDeleted: 4,
      usersProcessed: 1,
      s3KeysAttempted: 5,
    });
    mockPrisma.intent.findFirst.mockResolvedValue({ id: 1 });

    const result = await service.stopSearch(42);

    expect(maintenance.stopAndCleanupUsers).toHaveBeenCalledWith(
      [42],
      expect.objectContaining({ archiveMatches: true, stopIntents: true }),
    );
    expect(result.cleared?.searchAdressesDeleted).toBe(3);
    expect(result.cleared?.homeImgsDeleted).toBe(4);
    expect(result.cleared?.s3KeysAttempted).toBe(5);
  });
});
