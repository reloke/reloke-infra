import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationType } from '@prisma/client';
import * as webpush from 'web-push';
import { ConfigService } from '@nestjs/config';
import { ChatGateway } from '../chat/chat.gateway';
import { Inject, forwardRef } from '@nestjs/common';

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
    @Inject(forwardRef(() => ChatGateway))
    private chatGateway: ChatGateway,
  ) {
    const publicKey = this.configService.get<string>('VAPID_PUBLIC_KEY');
    const privateKey = this.configService.get<string>('VAPID_PRIVATE_KEY');
    const mailTo = this.configService.get<string>(
      'VAPID_MAILTO',
      'mailto:support@switchkey.com',
    );

    if (publicKey && privateKey) {
      webpush.setVapidDetails(mailTo, publicKey, privateKey);
      this.logger.log('VAPID details set for push notifications');
    } else {
      this.logger.warn(
        'VAPID keys not found in environment. Push notifications disabled.',
      );
    }
  }

  async createNotification(
    userId: number,
    type: NotificationType,
    content: string,
    metadata?: any,
  ) {
    // Grouping logic for MESSAGE type to avoid spamming
    if (type === 'MESSAGE' && metadata?.matchGroupId) {
      try {
        const existing = await this.prisma.notification.findFirst({
          where: {
            userId,
            type: 'MESSAGE',
            isRead: false,
            metadata: {
              path: ['matchGroupId'],
              equals: metadata.matchGroupId,
            },
          },
        });

        if (existing) {
          const existingMetadata = existing.metadata as any;
          const msgCount = (existingMetadata?.msgCount || 1) + 1;

          const notification = await this.prisma.notification.update({
            where: { id: existing.id },
            data: {
              content: `Vous avez ${msgCount} nouveaux messages`,
              createdAt: new Date(),
              isRead: false, // Ensure it's still unread if it was somehow marked while we processed
              metadata: {
                ...existingMetadata,
                msgCount,
              },
            },
          });

          this.chatGateway.emitNotification(userId, notification);
          return notification;
        }
      } catch (e) {
        this.logger.error('Error grouping notification:', e);
        // Fallback to creating a new one if grouping fails
      }
    }

    const notification = await this.prisma.notification.create({
      data: {
        userId,
        type,
        content,
        metadata: {
          ...(metadata || {}),
          msgCount: 1,
        },
      },
    });

    this.chatGateway.emitNotification(userId, notification);
    return notification;
  }

  async getUserNotifications(
    userId: number,
    page: number = 1,
    limit: number = 20,
  ) {
    const skip = (page - 1) * limit;
    return this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: skip,
    });
  }

  async getUnreadCount(userId: number) {
    return this.prisma.notification.count({
      where: { userId, isRead: false },
    });
  }

  async markAsRead(notificationId: number) {
    return this.prisma.notification.update({
      where: { id: notificationId },
      data: { isRead: true },
    });
  }

  async deleteNotification(userId: number, id: number) {
    return this.prisma.notification.delete({
      where: { id, userId },
    });
  }

  async deleteAllNotifications(userId: number) {
    return this.prisma.notification.deleteMany({
      where: { userId },
    });
  }

  async markAllAsRead(userId: number, matchGroupId?: string) {
    if (matchGroupId) {
      // Prisma Json filtering (works better if we cast or use specific syntax,
      // but for simplicity we can also fetch and update or use raw if needed.
      // Let's try the modern Prisma path syntax first)
      return this.prisma.notification.updateMany({
        where: {
          userId,
          isRead: false,
          metadata: {
            path: ['matchGroupId'],
            equals: matchGroupId,
          },
        },
        data: { isRead: true },
      });
    }

    return this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });
  }

  async addSubscription(userId: number, subscription: any) {
    return this.prisma.pushSubscription.upsert({
      where: { endpoint: subscription.endpoint },
      update: {
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        updatedAt: new Date(),
      },
      create: {
        userId,
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
      },
    });
  }

  async sendPushNotification(
    userId: number,
    title: string,
    body: string,
    data?: any,
  ): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { pushEnabled: true },
    });

    if (!user || !user.pushEnabled) return false;

    const subscriptions = await this.prisma.pushSubscription.findMany({
      where: { userId },
    });

    if (subscriptions.length === 0) return false;

    const payload = JSON.stringify({
      notification: {
        title,
        body,
        icon: '/assets/logo.png',
        data,
      },
    });

    let successCount = 0;

    const promises = subscriptions.map((sub) => {
      const pushSubscription = {
        endpoint: sub.endpoint,
        keys: {
          p256dh: sub.p256dh,
          auth: sub.auth,
        },
      };

      return webpush
        .sendNotification(pushSubscription, payload)
        .then(() => {
          successCount++;
        })
        .catch((err) => {
          if (err.statusCode === 404 || err.statusCode === 410) {
            this.logger.log(
              `Subscription expired or not found for user ${userId}. Removing.`,
            );
            return this.prisma.pushSubscription.delete({
              where: { id: sub.id },
            });
          }
          this.logger.error(
            `Error sending push notification to user ${userId}:`,
            err,
          );
        });
    });

    await Promise.all(promises);
    return successCount > 0;
  }
}
