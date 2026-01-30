import { MailService } from '../../src/mail/mail.service';

/**
 * Mock version of MailService for unit testing.
 * Captures email calls instead of sending them through AWS SES.
 */
export const MailServiceMock: Partial<Record<keyof MailService, jest.Mock>> = {
  verifyConfiguration: jest.fn().mockResolvedValue(true),
  sendEmail: jest.fn().mockResolvedValue(true),
  sendVerificationEmail: jest.fn().mockResolvedValue(true),
  sendWelcomeEmail: jest.fn().mockResolvedValue(true),
  sendPasswordResetEmail: jest.fn().mockResolvedValue(true),
  sendChangeEmailRequest: jest.fn().mockResolvedValue(true),
  sendNewEmailVerification: jest.fn().mockResolvedValue(true),
  sendPasswordUpdatedEmail: jest.fn().mockResolvedValue(true),
  sendDeletionRequestEmail: jest.fn().mockResolvedValue(true),
  sendAccountRestoredEmail: jest.fn().mockResolvedValue(true),
  sendInfluencerWelcomeEmail: jest.fn().mockResolvedValue(true),
  sendInfluencerReportEmail: jest.fn().mockResolvedValue(true),
  sendIdentityVerifiedEmail: jest.fn().mockResolvedValue(true),
  sendIdentityVerificationRetryEmail: jest.fn().mockResolvedValue(true),
  sendBanEmail: jest.fn().mockResolvedValue(true),
};
