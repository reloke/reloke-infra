import { StripeService } from '../../src/matching/services/stripe.service';

/**
 * Mock version of StripeService for unit testing.
 * Simulates Stripe API responses without network calls.
 */
export const StripeServiceMock: Partial<
  Record<keyof StripeService, jest.Mock>
> = {
  createVerificationSession: jest
    .fn()
    .mockImplementation(async (userId: number, email: string) => ({
      id: `vs_mock_${Date.now()}`,
      client_secret: `vi_secret_mock_${Date.now()}`,
      status: 'requires_input',
      url: 'https://stripe-mock-identity.com/session/123',
    })),
  getVerificationSession: jest
    .fn()
    .mockImplementation(async (sessionId: string) => ({
      id: sessionId,
      status: 'verified',
      metadata: { userId: '1' },
    })),
  constructEvent: jest.fn().mockImplementation((payload, signature) => ({
    id: 'evt_mock',
    type: 'identity.verification_session.verified',
    data: {
      object: {
        id: 'vs_mock_123',
        metadata: { userId: '1' },
      },
    },
  })),
  createRefund: jest.fn().mockImplementation(async (chargeId, amount, metadata) => ({
    id: `re_mock_${Date.now()}`,
    status: 'succeeded',
    amount,
  })),
};
