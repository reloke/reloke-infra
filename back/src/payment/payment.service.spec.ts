import { Test, TestingModule } from '@nestjs/testing';
import { PaymentService } from './payment.service';
import { PrismaService } from '../prisma/prisma.service';
import axios from 'axios';

jest.mock('axios');

describe('PaymentService', () => {
  let service: PaymentService;
  let prisma: PrismaService;
  const originalEnv = process.env;

  beforeEach(async () => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentService,
        {
          provide: PrismaService,
          useValue: {},
        },
      ],
    }).compile();

    service = module.get<PaymentService>(PaymentService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createOrder', () => {
    it('should return mock order if credentials are missing', async () => {
      delete process.env.PAYPAL_CLIENT_ID;
      delete process.env.PAYPAL_CLIENT_SECRET;

      const result = await service.createOrder(1, {
        amount: 15,
        packId: 'PACK_5',
      });
      expect(result.orderId).toContain('PAYPAL_ORDER_');
      expect(result.approvalUrl).toContain('sandbox.paypal.com');
    });

    it('should call PayPal API if credentials are present', async () => {
      process.env.PAYPAL_CLIENT_ID = 'test_id';
      process.env.PAYPAL_CLIENT_SECRET = 'test_secret';

      (axios.post as jest.Mock).mockResolvedValueOnce({
        data: { access_token: 'mock_token' },
      });
      (axios.post as jest.Mock).mockResolvedValueOnce({
        data: {
          id: 'ORDER_123',
          links: [{ rel: 'approve', href: 'https://approve.url' }],
        },
      });

      const result = await service.createOrder(1, {
        amount: 15,
        packId: 'PACK_5',
      });
      expect(result.orderId).toBe('ORDER_123');
      expect(result.approvalUrl).toBe('https://approve.url');
      expect(axios.post).toHaveBeenCalledTimes(2);
    });
  });
});
