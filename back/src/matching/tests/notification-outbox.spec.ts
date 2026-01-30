/**
 * Tests for NotificationOutboxService
 *
 * Tests cover:
 * 1. STANDARD match creates outbox entries for 2 users (1 match each)
 * 2. TRIANGLE match creates outbox entries for 3 users (1 match each)
 * 3. Outbox idempotency: rerun same runId must not double-send
 * 4. Aggregation: multiple matches in same runId = 1 email with sum
 */

import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../../mail/mail.service';
import { MatchingConfigService } from '../config/matching.config';
import { NotificationOutboxService } from '../services/notification-outbox.service';
import { MatchType } from '@prisma/client';

describe('NotificationOutboxService', () => {
  let service: NotificationOutboxService;
  let prisma: PrismaService;
  let mailService: MailService;

  // Mock transaction client
  const mockTx = {
    matchNotificationOutbox: {
      upsert: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
    },
    intent: {
      findFirst: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationOutboxService,
        {
          provide: PrismaService,
          useValue: {
            $queryRaw: jest.fn(),
            matchNotificationOutbox: {
              findMany: jest.fn(),
              updateMany: jest.fn(),
              update: jest.fn(),
              deleteMany: jest.fn(),
            },
            intent: {
              findFirst: jest.fn(),
            },
          },
        },
        {
          provide: MailService,
          useValue: {
            sendMatchesFoundEmail: jest.fn().mockResolvedValue(true),
          },
        },
        {
          provide: MatchingConfigService,
          useValue: {
            cronEnabled: false, // Disable auto-start for tests
            instanceId: 'test-worker',
          },
        },
      ],
    }).compile();

    service = module.get<NotificationOutboxService>(NotificationOutboxService);
    prisma = module.get<PrismaService>(PrismaService);
    mailService = module.get<MailService>(MailService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('writeStandardMatchOutbox', () => {
    it('should create outbox entries for both STANDARD match participants', async () => {
      const runId = 'test-run-123';
      const seekerData = { intentId: 1, userId: 100 };
      const targetData = { intentId: 2, userId: 200 };
      const matchUids = { seeker: 'uid-1', target: 'uid-2' };

      mockTx.matchNotificationOutbox.upsert.mockResolvedValue({});

      await service.writeStandardMatchOutbox(
        mockTx as any,
        runId,
        seekerData,
        targetData,
        matchUids,
      );

      // Should call upsert twice - once for each participant
      expect(mockTx.matchNotificationOutbox.upsert).toHaveBeenCalledTimes(2);

      // First call for seeker
      expect(mockTx.matchNotificationOutbox.upsert).toHaveBeenNthCalledWith(1, {
        where: {
          runId_userId_intentId: {
            runId,
            userId: 100,
            intentId: 1,
          },
        },
        create: expect.objectContaining({
          runId,
          userId: 100,
          intentId: 1,
          matchCountDelta: 1,
          matchType: MatchType.STANDARD,
        }),
        update: expect.objectContaining({
          matchCountDelta: { increment: 1 },
        }),
      });

      // Second call for target
      expect(mockTx.matchNotificationOutbox.upsert).toHaveBeenNthCalledWith(2, {
        where: {
          runId_userId_intentId: {
            runId,
            userId: 200,
            intentId: 2,
          },
        },
        create: expect.objectContaining({
          runId,
          userId: 200,
          intentId: 2,
          matchCountDelta: 1,
          matchType: MatchType.STANDARD,
        }),
        update: expect.objectContaining({
          matchCountDelta: { increment: 1 },
        }),
      });
    });

    it('should increment matchCountDelta on duplicate runId+userId+intentId', async () => {
      // The upsert with increment handles this automatically
      // This test verifies the update clause uses increment
      const runId = 'test-run-456';
      const seekerData = { intentId: 1, userId: 100 };
      const targetData = { intentId: 2, userId: 200 };
      const matchUids = { seeker: 'uid-1', target: 'uid-2' };

      mockTx.matchNotificationOutbox.upsert.mockResolvedValue({});

      await service.writeStandardMatchOutbox(
        mockTx as any,
        runId,
        seekerData,
        targetData,
        matchUids,
      );

      // Verify update uses increment (not replace)
      const firstCall = mockTx.matchNotificationOutbox.upsert.mock.calls[0][0];
      expect(firstCall.update.matchCountDelta).toEqual({ increment: 1 });
    });
  });

  describe('writeTriangleMatchOutbox', () => {
    it('should create outbox entries for all 3 TRIANGLE participants', async () => {
      const runId = 'test-run-789';
      const participants = [
        { intentId: 1, userId: 100 },
        { intentId: 2, userId: 200 },
        { intentId: 3, userId: 300 },
      ];
      const matchUids = ['uid-a', 'uid-b', 'uid-c'];

      mockTx.matchNotificationOutbox.upsert.mockResolvedValue({});

      await service.writeTriangleMatchOutbox(
        mockTx as any,
        runId,
        participants,
        matchUids,
      );

      // Should call upsert 3 times - once for each participant
      expect(mockTx.matchNotificationOutbox.upsert).toHaveBeenCalledTimes(3);

      // All calls should have matchType TRIANGLE and matchCountDelta 1
      for (let i = 0; i < 3; i++) {
        const call = mockTx.matchNotificationOutbox.upsert.mock.calls[i][0];
        expect(call.create.matchType).toBe(MatchType.TRIANGLE);
        expect(call.create.matchCountDelta).toBe(1);
        expect(call.create.userId).toBe(participants[i].userId);
      }
    });

    it('should use matchCountDelta=1 per triangle (not 3)', async () => {
      // Each user in a triangle sees "1 new match" not "3 new matches"
      const runId = 'test-run-triangle';
      const participants = [
        { intentId: 1, userId: 100 },
        { intentId: 2, userId: 200 },
        { intentId: 3, userId: 300 },
      ];
      const matchUids = ['uid-a', 'uid-b', 'uid-c'];

      mockTx.matchNotificationOutbox.upsert.mockResolvedValue({});

      await service.writeTriangleMatchOutbox(
        mockTx as any,
        runId,
        participants,
        matchUids,
      );

      // Verify each create has matchCountDelta = 1
      for (const call of mockTx.matchNotificationOutbox.upsert.mock.calls) {
        expect(call[0].create.matchCountDelta).toBe(1);
      }
    });
  });

  describe('processOutbox (idempotency)', () => {
    it('should not send duplicate emails for same runId', async () => {
      // Simulate outbox records
      const mockRecords = [
        {
          id: 1,
          runId: 'run-1',
          userId: 100,
          intentId: 1,
          matchCountDelta: 2,
          matchType: MatchType.STANDARD,
          matchUids: ['uid-1', 'uid-2'],
          attempts: 0,
          maxAttempts: 5,
        },
      ];

      // Mock the raw query to return records
      (prisma.$queryRaw as jest.Mock).mockResolvedValue(mockRecords);

      // Mock intent lookup
      (prisma.intent.findFirst as jest.Mock).mockResolvedValue({
        totalMatchesRemaining: 5,
        user: {
          mail: 'test@example.com',
          firstName: 'John',
          lastName: 'Doe',
        },
      });

      // Mock updateMany for marking processed
      (
        prisma.matchNotificationOutbox.updateMany as jest.Mock
      ).mockResolvedValue({ count: 1 });

      await service.processOutbox();

      // Should send exactly 1 email (aggregated)
      expect(mailService.sendMatchesFoundEmail).toHaveBeenCalledTimes(1);
      expect(mailService.sendMatchesFoundEmail).toHaveBeenCalledWith(
        'test@example.com',
        'John',
        2, // aggregated count
        5, // remaining credits
      );

      // Should mark records as processed
      expect(prisma.matchNotificationOutbox.updateMany).toHaveBeenCalledWith({
        where: { id: { in: [1] } },
        data: expect.objectContaining({
          processedAt: expect.any(Date),
        }),
      });
    });

    it('should aggregate multiple outbox records for same user', async () => {
      // Same user has 2 outbox records in same run (e.g., 2 matches found)
      const mockRecords = [
        {
          id: 1,
          runId: 'run-1',
          userId: 100,
          intentId: 1,
          matchCountDelta: 1,
          matchType: MatchType.STANDARD,
          matchUids: ['uid-1'],
          attempts: 0,
          maxAttempts: 5,
        },
        {
          id: 2,
          runId: 'run-1',
          userId: 100,
          intentId: 1,
          matchCountDelta: 1,
          matchType: MatchType.TRIANGLE,
          matchUids: ['uid-2'],
          attempts: 0,
          maxAttempts: 5,
        },
      ];

      (prisma.$queryRaw as jest.Mock).mockResolvedValue(mockRecords);
      (prisma.intent.findFirst as jest.Mock).mockResolvedValue({
        totalMatchesRemaining: 3,
        user: {
          mail: 'test@example.com',
          firstName: 'Jane',
          lastName: 'Doe',
        },
      });
      (
        prisma.matchNotificationOutbox.updateMany as jest.Mock
      ).mockResolvedValue({ count: 2 });

      await service.processOutbox();

      // Should send 1 email with total count = 2
      expect(mailService.sendMatchesFoundEmail).toHaveBeenCalledTimes(1);
      expect(mailService.sendMatchesFoundEmail).toHaveBeenCalledWith(
        'test@example.com',
        'Jane',
        2, // 1 + 1 aggregated
        3,
      );

      // Should mark both records as processed
      expect(prisma.matchNotificationOutbox.updateMany).toHaveBeenCalledWith({
        where: { id: { in: [1, 2] } },
        data: expect.objectContaining({
          processedAt: expect.any(Date),
        }),
      });
    });

    it('should not reprocess already processed records', async () => {
      // Query returns no records (all already processed)
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([]);

      const result = await service.processOutbox();

      expect(result).toBe(0);
      expect(mailService.sendMatchesFoundEmail).not.toHaveBeenCalled();
    });
  });

  describe('email count semantics', () => {
    it('STANDARD match: each of 2 users sees 1 match (not 2 rows)', async () => {
      // When a STANDARD match is created, 2 Match rows are created
      // But each user should see "1 new match" in email
      const runId = 'run-standard';
      const seekerData = { intentId: 1, userId: 100 };
      const targetData = { intentId: 2, userId: 200 };
      const matchUids = { seeker: 'uid-1', target: 'uid-2' };

      mockTx.matchNotificationOutbox.upsert.mockResolvedValue({});

      await service.writeStandardMatchOutbox(
        mockTx as any,
        runId,
        seekerData,
        targetData,
        matchUids,
      );

      // Each user gets matchCountDelta = 1
      const call1 = mockTx.matchNotificationOutbox.upsert.mock.calls[0][0];
      const call2 = mockTx.matchNotificationOutbox.upsert.mock.calls[1][0];

      expect(call1.create.matchCountDelta).toBe(1);
      expect(call2.create.matchCountDelta).toBe(1);
    });

    it('TRIANGLE match: each of 3 users sees 1 match (not 3 rows)', async () => {
      // When a TRIANGLE match is created, 3 Match rows are created
      // But each user should see "1 new match" in email
      const runId = 'run-triangle';
      const participants = [
        { intentId: 1, userId: 100 },
        { intentId: 2, userId: 200 },
        { intentId: 3, userId: 300 },
      ];
      const matchUids = ['uid-a', 'uid-b', 'uid-c'];

      mockTx.matchNotificationOutbox.upsert.mockResolvedValue({});

      await service.writeTriangleMatchOutbox(
        mockTx as any,
        runId,
        participants,
        matchUids,
      );

      // Each user gets matchCountDelta = 1
      for (const call of mockTx.matchNotificationOutbox.upsert.mock.calls) {
        expect(call[0].create.matchCountDelta).toBe(1);
      }
    });
  });
});
