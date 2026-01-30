import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { S3Service } from '../src/home/services/s3.service';
import { StripeService } from '../src/matching/services/stripe.service';
import { MailService } from '../src/mail/mail.service';
import { S3ServiceMock } from './mocks/s3.service.mock';
import { StripeServiceMock } from './mocks/stripe.service.mock';
import { MailServiceMock } from './mocks/mail.service.mock';
import { DataLifecycleService } from '../src/gdpr/services/data-lifecycle.service';
import { JwtService } from '@nestjs/jwt';
import { HelpTopic, ReportStatus } from '@prisma/client';
import { ChatGateway } from '../src/chat/chat.gateway';
import { NotificationService } from '../src/notification/notification.service';

jest.setTimeout(120000); // 120 seconds for E2E

const ChatGatewayMock = {
    broadcastMessagesDeleted: jest.fn(),
    broadcastNewMessage: jest.fn(),
    broadcastQuotaUpdate: jest.fn(),
    broadcastMessageUpdated: jest.fn(),
};

// Mock NotificationService
const NotificationServiceMock = {
    sendNotification: jest.fn().mockResolvedValue(true),
    sendPushNotification: jest.fn().mockResolvedValue(true),
};

// Mock MatchingPaymentsService
const MatchingPaymentsServiceMock = {
    requestRefund: jest.fn().mockResolvedValue({
        success: true,
        matchesRefunded: 0,
        refundedAmount: 0,
    }),
};

import { MatchingPaymentsService } from '../src/matching/services/matching-payments.service';

describe('GDPR Compliance (e2e)', () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let jwtService: JwtService;
    let lifecycleService: DataLifecycleService;

    beforeAll(async () => {
        const moduleFixture: TestingModule = await Test.createTestingModule({
            imports: [AppModule],
        })
            .overrideProvider(S3Service)
            .useValue(S3ServiceMock)
            .overrideProvider(StripeService)
            .useValue(StripeServiceMock)
            .overrideProvider(MailService)
            .useValue(MailServiceMock)
            .overrideProvider(ChatGateway)
            .useValue(ChatGatewayMock)
            .overrideProvider(NotificationService)
            .useValue(NotificationServiceMock)
            .overrideProvider(MatchingPaymentsService)
            .useValue(MatchingPaymentsServiceMock)
            .compile();

        app = moduleFixture.createNestApplication();
        await app.init();

        prisma = app.get(PrismaService);
        jwtService = app.get(JwtService);
        lifecycleService = app.get(DataLifecycleService);
    });

    afterAll(async () => {
        if (prisma) {
            await prisma.$disconnect();
        }
        await app.close();
    });

    const createTestUser = async (email: string, lastName = 'Test') => {
        const user = await prisma.user.create({
            data: {
                mail: email,
                firstName: 'GDPR',
                lastName: lastName,
                password: 'hashed_password',
                status: 'ACTIVE',
                isActif: true,
                isLocked: false,
                tokenVersion: 1,
            },
        });
        const token = jwtService.sign({
            sub: user.id,
            email: user.mail,
            version: user.tokenVersion
        });
        return { user, token };
    };

    /**
     * P1.1 - Unification Suppression Compte (30 jours)
     */
    describe('P1.1 - Account Deletion Scheduling', () => {
        it('should schedule deletion for 30 days and invalidate sessions', async () => {
            const { user, token } = await createTestUser(`p11_simple_${Date.now()}@example.com`);
            const response = await request(app.getHttpServer())
                .post('/v1/me/delete-account')
                .set('Authorization', `Bearer ${token}`)
                .expect(HttpStatus.CREATED);

            expect(response.body.message).toContain('30 jours');

            const updatedUser = await prisma.user.findUnique({ where: { id: user.id } });
            expect(updatedUser.status).toBe('PENDING_DELETION');
            expect(updatedUser.tokenVersion).toBe(2);
        });

        it('should handle legal hold by disabling instead of pending deletion', async () => {
            const { user, token } = await createTestUser(`p11_hold_${Date.now()}@example.com`);

            await prisma.legalCase.create({
                data: {
                    type: 'FRAUD',
                    status: 'OPEN',
                    userId: user.id,
                    openedAt: new Date(),
                }
            });

            await request(app.getHttpServer())
                .post('/v1/me/delete-account')
                .set('Authorization', `Bearer ${token}`)
                .expect(HttpStatus.CREATED);

            const updatedUser = await prisma.user.findUnique({ where: { id: user.id } });
            expect(updatedUser.status).toBe('DISABLED');
        });
    });

    /**
     * P1.2 - Fix FK Violation Intent/Payment
     */
    describe('P1.2 - Intent/Payment Retention', () => {
        it('should preserve intent if it has linked payments', async () => {
            const { user } = await createTestUser(`p12_pay_${Date.now()}@example.com`);

            const intent = await prisma.intent.create({
                data: {
                    userId: user.id,
                    totalMatchesPurchased: 5,
                    totalMatchesRemaining: 5,
                }
            });

            await prisma.payment.create({
                data: {
                    stripeCheckoutSessionId: `sess_p12_${user.id}`,
                    planType: 'PACK_5',
                    matchesInitial: 5,
                    amountBase: 12.99,
                    amountFees: 0,
                    amountTotal: 12.99,
                    pricePerMatch: 2.5,
                    status: 'SUCCEEDED',
                    userId: user.id,
                    intentId: intent.id,
                    stripeChargeId: 'ch_mock',
                }
            });

            await prisma.user.update({
                where: { id: user.id },
                data: { deletionScheduledAt: new Date(Date.now() - 1000), status: 'PENDING_DELETION' }
            });

            await lifecycleService.finalizeUserDeletions();

            const anonymizedUser = await prisma.user.findUnique({ where: { id: user.id } });
            expect(anonymizedUser.status).toBe('ANONYMIZED');

            const savedIntent = await prisma.intent.findUnique({ where: { id: intent.id } });
            expect(savedIntent).not.toBeNull();
        });

        it('should delete intent if it has NO linked payments', async () => {
            const { user } = await createTestUser(`p12_nopay_${Date.now()}@example.com`);

            const intent = await prisma.intent.create({
                data: {
                    userId: user.id,
                    totalMatchesPurchased: 0,
                }
            });

            await prisma.user.update({
                where: { id: user.id },
                data: { deletionScheduledAt: new Date(Date.now() - 1000), status: 'PENDING_DELETION' }
            });

            await lifecycleService.finalizeUserDeletions();

            const savedIntent = await prisma.intent.findUnique({ where: { id: intent.id } });
            expect(savedIntent).toBeNull();
        });
    });

    /**
     * P1.3 - Purge S3 Complète
     */
    describe('P1.3 - Full S3 Purge', () => {
        it('should delete HelpRequest attachments from S3', async () => {
            const { user } = await createTestUser(`p13_s3_${Date.now()}@example.com`);

            const helpReq = await prisma.helpRequest.create({
                data: {
                    userId: user.id,
                    topic: HelpTopic.OTHER,
                    description: 'Help!',
                }
            });

            await prisma.helpRequestAttachment.create({
                data: {
                    helpRequestId: helpReq.id,
                    url: 'help-requests/proof.pdf'
                }
            });

            await prisma.user.update({
                where: { id: user.id },
                data: { deletionScheduledAt: new Date(Date.now() - 1000), status: 'PENDING_DELETION' }
            });

            const s3DeleteSpy = jest.spyOn(S3ServiceMock, 'deleteFile');

            await lifecycleService.finalizeUserDeletions();

            expect(s3DeleteSpy).toHaveBeenCalledWith('help-requests/proof.pdf');
        });
    });

    /**
     * P1.4 - Endpoint DELETE Message Individuel
     */
    describe('P1.4 - Individual Message Deletion', () => {
        it('should redact message and delete from S3', async () => {
            const { user, token } = await createTestUser(`p14_msg_${Date.now()}@example.com`);

            const chat = await prisma.chat.create({ data: { status: 'ACTIVE' } });
            await prisma.chatParticipant.create({ data: { chatId: chat.id, userId: user.id } });

            const msg = await prisma.message.create({
                data: {
                    chatId: chat.id,
                    senderId: user.id,
                    content: 'Secret message',
                }
            });

            await prisma.messageImg.create({
                data: {
                    messageId: msg.id,
                    url: 'messages/pic.jpg'
                }
            });

            await request(app.getHttpServer())
                .delete(`/chat/${chat.id}/messages/${msg.id}`)
                .set('Authorization', `Bearer ${token}`)
                .expect(HttpStatus.OK);

            const deletedMsg = await prisma.message.findUnique({ where: { id: msg.id } });
            expect(deletedMsg.isDeleted).toBe(true);
            expect(deletedMsg.content).toContain('supprimé');
        });

        it('should block deletion if report is active', async () => {
            const { user, token } = await createTestUser(`p14_rep_${Date.now()}@example.com`);
            const { user: reporter } = await createTestUser(`p14_reporter_${Date.now()}@example.com`);

            const chat = await prisma.chat.create({ data: { status: 'ACTIVE' } });
            await prisma.chatParticipant.createMany({
                data: [{ chatId: chat.id, userId: user.id }, { chatId: chat.id, userId: reporter.id }]
            });

            const msg = await prisma.message.create({
                data: { chatId: chat.id, senderId: user.id, content: 'Bad message' }
            });

            await prisma.report.create({
                data: {
                    chatId: chat.id,
                    reporterId: reporter.id,
                    reportedUserId: user.id,
                    messageId: msg.id,
                    status: ReportStatus.PENDING,
                    reason: 'SPAM',
                }
            });

            await request(app.getHttpServer())
                .delete(`/chat/${chat.id}/messages/${msg.id}`)
                .set('Authorization', `Bearer ${token}`)
                .expect(HttpStatus.FORBIDDEN);
        });
    });

    /**
     * P1.5 - Purge NotificationLog Automatique
     */
    describe('P1.5 - Log Purging', () => {
        it('should purge logs older than 12 months', async () => {
            const { user } = await createTestUser(`p15_logs_${Date.now()}@example.com`);

            const oldDate = new Date();
            oldDate.setFullYear(oldDate.getFullYear() - 2);

            await prisma.notificationLog.create({
                data: {
                    userId: user.id,
                    type: 'TEST',
                    runId: 'old-run-' + Date.now(),
                    createdAt: oldDate,
                }
            });

            const result = await lifecycleService.purgeOldLogs();
            expect(result.notificationLogs).toBeGreaterThanOrEqual(1);
        });
    });
});
