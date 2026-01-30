import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MatchType, MessageType, Prisma } from '@prisma/client';
import { S3Service } from '../home/services/s3.service';


@Injectable()
export class ChatService {
  constructor(
    private prisma: PrismaService,
    private s3Service: S3Service,
  ) { }

  async checkIfUserBanned(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { status: true, isBanned: true, isLocked: true },
    });
    if (user && (user.status === 'BANNED' || user.isBanned || user.isLocked)) {
      throw new ForbiddenException(
        'Votre compte est suspendu. Cette action est impossible.',
      );
    }
  }


  /**
   * Create (or return existing) chat for a match group.
   * Ensures requester is one of the participants.
   */
  async createChatForMatchGroup(matchGroupId: string, requesterId: number) {
    // Return existing chat if present
    const existing = await this.prisma.chat.findUnique({
      where: { matchGroupId },
      include: { participants: true },
    });
    if (existing) {
      const isParticipant = existing.participants.some(p => p.userId === requesterId);
      if (!isParticipant) {
        throw new ForbiddenException('Vous ne pouvez pas accÃ©der Ã  ce chat.');
      }
      return existing;
    }

    // Fetch matches for group to derive participants and type
    const matches = await this.prisma.match.findMany({
      where: { groupId: matchGroupId },
      include: {
        seekerIntent: { select: { userId: true } },
        targetIntent: { select: { userId: true } },
      },
    });

    if (matches.length === 0) {
      throw new NotFoundException('Groupe de match introuvable');
    }

    const participantIds = new Set<number>();
    for (const m of matches) {
      if (m.seekerIntent?.userId) participantIds.add(m.seekerIntent.userId);
      if (m.targetIntent?.userId) participantIds.add(m.targetIntent.userId);
    }

    if (!participantIds.has(requesterId)) {
      throw new ForbiddenException('Vous ne pouvez pas crÃ©er ce chat.');
    }

    const type = matches[0].type as MatchType;

    return this.prisma.chat.create({
      data: {
        matchGroupId,
        type,
        participants: {
          create: Array.from(participantIds).map((userId) => ({ userId })),
        },
      },
      include: { participants: true },
    });
  }


  async getMessageQuota(chatId: number, userId: number) {
    // 1. Check if the chat is already "established" (at least one real message received)
    // If so, the quota (which is meant for the first messages only) is disabled.
    const receivedMessagesCount = await this.prisma.message.count({
      where: {
        chatId,
        senderId: { not: userId },
        isDeleted: false, // Only count non-deleted messages as an "answer"
      },
    });

    if (receivedMessagesCount > 0) {
      return { count: 0, isBlocked: false, limit: 5, isEstablished: true };
    }

    // 2. Since NO message was received yet, the quota is strict.
    // We count ALL messages sent by the user in this conversation.
    // (Improved: we don't rely on lastSeenAt anymore to avoid lifting the quota 
    // just because the other person opened the chat without answering).
    const sentMessagesCount = await this.prisma.message.count({
      where: {
        chatId,
        senderId: userId,
        isDeleted: false,
        type: {
          in: [
            MessageType.TEXT,
            MessageType.IMAGE,
            MessageType.CONTACT,
            MessageType.FILE,
          ],
        },
      },
    });

    return {
      count: sentMessagesCount,
      isBlocked: sentMessagesCount >= 5,
      limit: 5,
      isEstablished: false,
    };
  }

  /**
   * Lightweight query to get chat room identifiers for WebSocket room join.
   * No unread counts, no messages — just chatId + matchGroupId.
   */
  async getUserChatRooms(
    userId: number,
  ): Promise<{ chatId: number; matchGroupId: string | null }[]> {
    const participations = await this.prisma.chatParticipant.findMany({
      where: { userId },
      select: {
        chatId: true,
        chat: { select: { matchGroupId: true } },
      },
    });
    return participations.map((p) => ({
      chatId: p.chatId,
      matchGroupId: p.chat.matchGroupId,
    }));
  }

  /**
   * Lightweight chat lookup for sendMessage — verifies participation and returns status.
   */
  async getChatForSend(chatId: number, userId: number) {
    const chat = await this.prisma.chat.findUnique({
      where: { id: chatId },
      select: { id: true, matchGroupId: true, status: true },
    });
    if (!chat) return null;

    const isParticipant = await this.isParticipant(chatId, userId);
    if (!isParticipant) return null;

    return chat;
  }

  async getConversations(userId: number, limit: number = 50, cursor?: number) {
    const conversations = await this.prisma.chat.findMany({
      where: {
        participants: {
          some: { userId },
        },
      },
      include: {
        participants: {
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                profilePicture: true,
              },
            },
          },
        },
        messages: {
          take: 1,
          orderBy: { createdAt: 'desc' },
          include: { images: true },
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: limit,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
    });

    // Get all chat IDs and user's lastSeenAt in one query
    const chatIds = conversations.map((c) => c.id);
    if (chatIds.length === 0) {
      return [];
    }

    const participants = await this.prisma.chatParticipant.findMany({
      where: {
        chatId: { in: chatIds },
        userId: userId,
      },
      select: {
        chatId: true,
        lastSeenAt: true,
      },
    });

    // Build a map of chatId -> lastSeenAt for quick lookup
    const lastSeenMap = new Map(
      participants.map((p) => [p.chatId, p.lastSeenAt]),
    );

    // Get all unread counts in a single raw query for performance
    const unreadCounts = await this.prisma.$queryRaw<
      Array<{ chatId: number; unreadCount: bigint }>
    >`
            SELECT m."chatId", COUNT(*)::int as "unreadCount"
            FROM "Message" m
            INNER JOIN "ChatParticipant" cp ON cp."chatId" = m."chatId" AND cp."userId" = ${userId}
            WHERE m."chatId" IN (${Prisma.join(chatIds)})
              AND m."createdAt" > cp."lastSeenAt"
              AND m."senderId" != ${userId}
            GROUP BY m."chatId"
        `;

    // Build a map of chatId -> unreadCount for quick lookup
    const unreadMap = new Map(
      unreadCounts.map((u) => [u.chatId, Number(u.unreadCount)]),
    );

    // Enrich conversations with unread counts (no more N+1 queries)
    const enrichedConversations = await Promise.all(
      conversations.map(async (conv) => {
        const unreadCount = unreadMap.get(conv.id) || 0;

        // Sign last message if needed
        if (conv.messages && conv.messages.length > 0) {
          conv.messages[0] = await this.signMessage(conv.messages[0]);
        }

        return {
          ...conv,
          unreadCount,
        };
      }),
    );

    // Sort by lastMessageAt (active) or createdAt (new match) descending
    return enrichedConversations.sort((a, b) => {
      // Robustly determine sort timestamp (handle nulls and potential invalid dates)
      const valA = a.lastMessageAt || a.createdAt;
      const valB = b.lastMessageAt || b.createdAt;

      // Ensure valid timestamps (default to 0 if invalid to prevent sort errors)
      const timeA = valA ? new Date(valA).getTime() : 0;
      const timeB = valB ? new Date(valB).getTime() : 0;
      const safeTA = isNaN(timeA) ? 0 : timeA;
      const safeTB = isNaN(timeB) ? 0 : timeB;

      return safeTB - safeTA;
    });
  }

  async markAsRead(chatId: number, userId: number) {
    return this.prisma.chatParticipant.update({
      where: {
        chatId_userId: { chatId, userId },
      },
      data: {
        lastSeenAt: new Date(),
      },
    });
  }

  async getChatWithParticipants(chatId: number) {
    return this.prisma.chat.findUnique({
      where: { id: chatId },
      include: {
        participants: {
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                profilePicture: true,
                mail: true,
              },
            },
          },
        },
      },
    });
  }

  async getChatByMatchGroupId(matchGroupId: string, userId: number) {
    const chat = await this.prisma.chat.findUnique({
      where: { matchGroupId },
      include: {
        participants: {
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                profilePicture: true,
              },
            },
          },
        },
      },
    });

    if (!chat) {
      throw new NotFoundException('Chat not found');
    }

    const isParticipant = chat.participants.some((p) => p.userId === userId);
    if (!isParticipant) {
      throw new ForbiddenException('You are not a participant in this chat');
    }

    return chat;
  }

  async getMessages(
    chatId: number,
    userId: number,
    limit = 50,
    cursor?: number,
  ) {
    // Verify participation
    const participation = await this.prisma.chatParticipant.findUnique({
      where: {
        chatId_userId: { chatId, userId },
      },
    });

    if (!participation) {
      throw new ForbiddenException('You are not a participant in this chat');
    }

    const messages = await this.prisma.message.findMany({
      where: { chatId },
      include: {
        sender: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            profilePicture: true,
          },
        },
        images: true,
        replyTo: {
          include: {
            sender: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                profilePicture: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    return await this.signMessages(messages);
  }

  private async signMessages(messages: any[]) {
    return Promise.all(messages.map((m) => this.signMessage(m)));
  }

  private async signMessage(message: any) {
    if (!message) return null;

    // Sign main fileUrl if exists
    if (message.fileUrl) {
      const key = this.extractS3Key(message.fileUrl);
      if (key) {
        try {
          message.fileUrl = await this.s3Service.getPublicUrl(key);
        } catch (err) {
          console.warn(
            `[ChatService] Failed to sign fileUrl for message ${message.id}:`,
            err.message,
          );
        }
      }
    }

    // Sign images
    if (message.images && message.images.length > 0) {
      message.images = await Promise.all(
        message.images.map(async (img: any) => {
          const key = this.extractS3Key(img.url);
          if (key) {
            try {
              img.url = await this.s3Service.getPublicUrl(key);
            } catch (err) {
              console.warn(
                `[ChatService] Failed to sign image URL ${img.id} for message ${message.id}:`,
                err.message,
              );
            }
          }
          return img;
        }),
      );
    }

    // Sign original message if it's a reply
    if (message.replyTo) {
      message.replyTo = await this.signMessage(message.replyTo);
    }

    return message;
  }

  async saveMessage(
    chatId: number,
    senderId: number,
    content: string,
    type: MessageType = MessageType.TEXT,
    fileUrl?: string,
    fileType?: string,
    imageUrls?: string[],
    replyToId?: number,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const message = await tx.message.create({
        data: {
          chatId,
          senderId,
          content,
          type,
          fileUrl,
          fileType,
          replyToId,
          images:
            imageUrls && imageUrls.length > 0
              ? {
                create: imageUrls.map((url) => ({ url })),
              }
              : undefined,
        },
        include: {
          sender: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              mail: true,
            },
          },
          images: true,
          replyTo: {
            include: {
              sender: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                },
              },
            },
          },
        },
      });

      await tx.chat.update({
        where: { id: chatId },
        data: { lastMessageAt: new Date() },
      });

      return await this.signMessage(message);
    });
  }

  async updateMessage(messageId: number, userId: number, content: string) {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
    });

    if (!message) throw new NotFoundException('Message not found');
    if (message.senderId !== userId)
      throw new ForbiddenException('You can only edit your own messages');

    return this.prisma.message.update({
      where: { id: messageId },
      data: {
        content,
        isEdited: true,
        editedAt: new Date(),
      },
      include: {
        sender: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
        replyTo: {
          include: {
            sender: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
              },
            },
          },
        },
      },
    });
  }

  async exitFlow(chatId: number, userId: number) {
    return this.prisma.$transaction(async (tx) => {
      const chat = await tx.chat.findUnique({
        where: { id: chatId },
        include: { participants: true },
      });

      if (!chat) throw new NotFoundException('Chat not found');

      // Set cooldown for user (2 weeks)
      const cooldownDate = new Date();
      cooldownDate.setDate(cooldownDate.getDate() + 14);

      await tx.user.update({
        where: { id: userId },
        data: {
          flowCooldownUntil: cooldownDate,
        },
      });

      await tx.intent.updateMany({
        where: { userId: userId },
        data: {
          isInFlow: false, // Stop matching
        },
      });

      return {
        message: 'Successfully left flow. Cooldown applied.',
        cooldownUntil: cooldownDate,
      };
    });
  }

  async getMatchGroupInfo(matchGroupId: string) {
    const matches = (await this.prisma.match.findMany({
      where: { groupId: matchGroupId },
      include: {
        seekerIntent: {
          include: {
            user: {
              select: { id: true, firstName: true, lastName: true },
            },
            home: {
              include: { images: true },
            },
          },
        },
      },
    })) as any[];

    if (matches.length === 0)
      throw new NotFoundException('Match group not found');

    const enrichedMatches = await Promise.all(
      matches.map(async (m) => {
        const targetHome = {
          ...(m.seekerIntent.home || {}),
          intentId: m.seekerIntent.id,
          images: [],
        };

        if (m.seekerIntent.home?.images) {
          targetHome.images = await Promise.all(
            m.seekerIntent.home.images.map(async (img: any) => {
              const key = img.url; // url is the S3 key in HomeImg
              try {
                return {
                  ...img,
                  url: await this.s3Service.getPublicUrl(key),
                };
              } catch (err) {
                console.warn(
                  `[ChatService] Failed to sign home image ${img.id}:`,
                  err.message,
                );
                return img;
              }
            }),
          );
        }

        return {
          id: m.id,
          uid: m.uid,
          status: m.status,
          snapshot: m.snapshot,
          seeker: m.seekerIntent.user,
          seekerIntentId: m.seekerIntent.id,
          targetHome,
        };
      }),
    );

    return {
      groupId: matchGroupId,
      type: matches[0].type,
      matches: enrichedMatches,
    };
  }

  async isParticipant(chatId: number, userId: number): Promise<boolean> {
    const count = await this.prisma.chatParticipant.count({
      where: { chatId, userId },
    });
    return count > 0;
  }

  async deleteMessages(chatId: number, userId: number, messageIds: number[]) {
    // Verify participation
    const isParticipant = await this.isParticipant(chatId, userId);
    if (!isParticipant) {
      throw new ForbiddenException('You are not a participant in this chat');
    }

    const ids = messageIds.map((id) => Number(id));

    // 1. Fetch messages to get S3 keys before deletion
    const messagesToDelete = await this.prisma.message.findMany({
      where: {
        id: { in: ids },
        chatId: chatId,
        senderId: userId, // Only allow deleting own messages for now
      },
      include: {
        images: true,
      },
    });

    if (messagesToDelete.length === 0) {
      return { count: 0, deletedIds: [] };
    }

    const actualDeletedIds = messagesToDelete.map((m) => m.id);

    // 2. Collect S3 keys
    const keysToDelete: string[] = [];
    for (const msg of messagesToDelete) {
      if (msg.fileUrl) {
        const key = this.extractS3Key(msg.fileUrl);
        if (key) keysToDelete.push(key);
      }
      if (msg.images) {
        for (const img of msg.images) {
          const key = this.extractS3Key(img.url);
          if (key) keysToDelete.push(key);
        }
      }
    }

    // Use a Set to unique keys
    const uniqueKeys = Array.from(new Set(keysToDelete));

    // 3. Delete from database
    // Note: reports on these messages will have messageId set to null or be handled by constraint
    // According to schema, Report.messageId is optional and NOT Cascade.
    // We should set it to null first to avoid constraint violation if any reports exist.
    await this.prisma.report.updateMany({
      where: { messageId: { in: actualDeletedIds } },
      data: { messageId: null },
    });

    const deleted = await this.prisma.message.deleteMany({
      where: {
        id: { in: actualDeletedIds },
      },
    });

    // 4. Delete from S3 (async, don't wait if not critical, but here we wait to ensure it's done)
    if (uniqueKeys.length > 0) {
      try {
        await this.s3Service.deleteFiles(uniqueKeys);
      } catch (err) {
        console.error('[ChatService] Error deleting files from S3:', err);
      }
    }

    return { count: deleted.count, deletedIds: actualDeletedIds };
  }

  private extractS3Key(url: string): string | null {
    if (!url) return null;
    try {
      // Support both full S3 URLs and keys stored directly
      if (!url.startsWith('http')) return url;

      const parsedUrl = new URL(url);
      // pathname starts with a slash, we want to remove it
      const key = parsedUrl.pathname.substring(1);

      // If it's a pre-signed URL with query params, the pathname is just the key
      // but we should make sure we don't have the bucket name in the path (path-style)
      // Modern SDK uses virtual-host style: bucket.s3.region.amazonaws.com/key
      return decodeURIComponent(key);
    } catch (e) {
      return null;
    }
  }

  async saveContactMessage(
    chatId: number,
    senderId: number,
    matchGroupId: string,
    contactData: {
      name: string;
      email: string;
      phone: string;
      targetUserId?: number;
    },
  ) {
    return this.prisma.$transaction(async (tx) => {
      const message = await tx.message.create({
        data: {
          chatId,
          senderId,
          content: `Nouveau contact partagé : ${contactData.name}`,
          type: MessageType.CONTACT,
          contactName: contactData.name,
          contactEmail: contactData.email,
          contactPhone: contactData.phone,
          contactTargetUserId: contactData.targetUserId,
        },
        include: {
          sender: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              mail: true,
            },
          },
          contactTargetUser: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
            },
          },
        },
      });

      await tx.chat.update({
        where: { id: chatId },
        data: { lastMessageAt: new Date() },
      });

      return message;
    });
  }

  async updateContactMessage(
    messageId: number,
    userId: number,
    contactData: { name: string; email: string; phone: string },
  ) {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
    });

    if (!message) throw new NotFoundException('Message not found');
    if (message.senderId !== userId)
      throw new ForbiddenException('You can only edit your own messages');
    if (message.type !== MessageType.CONTACT)
      throw new BadRequestException('This message is not a contact message');

    return this.prisma.message.update({
      where: { id: messageId },
      data: {
        contactName: contactData.name,
        contactEmail: contactData.email,
        contactPhone: contactData.phone,
        isEdited: true,
        editedAt: new Date(),
      },
      include: {
        sender: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
        contactTargetUser: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    });
  }

  async getConversationContacts(chatId: number, userId: number) {
    // Verify participation
    const isParticipant = await this.isParticipant(chatId, userId);
    if (!isParticipant) {
      throw new ForbiddenException('You are not a participant in this chat');
    }

    return this.prisma.message.findMany({
      where: {
        chatId,
        type: MessageType.CONTACT,
      },
      include: {
        sender: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
        contactTargetUser: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async deleteImage(
    chatId: number,
    messageId: number,
    imageId: number,
    userId: number,
  ) {
    // 1. Fetch message and images
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      include: { images: true },
    });

    if (!message || message.chatId !== chatId) {
      throw new NotFoundException('Message not found');
    }

    if (message.senderId !== userId) {
      throw new ForbiddenException('You can only delete your own images');
    }

    const image = message.images.find((img) => img.id === imageId);
    if (!image) {
      throw new NotFoundException('Image not found in this message');
    }

    // 2. Delete from S3
    const key = this.extractS3Key(image.url);
    if (key) {
      try {
        await this.s3Service.deleteFile(key);
      } catch (err) {
        console.error('[ChatService] Error deleting file from S3:', err);
      }
    }

    // 3. Delete from DB
    await this.prisma.messageImg.delete({
      where: { id: imageId },
    });

    // 4. Check if message should be deleted (if it was the last image and it's an IMAGE type message)
    const remainingImages = message.images.filter((img) => img.id !== imageId);
    if (remainingImages.length === 0 && message.type === 'IMAGE') {
      await this.prisma.message.delete({
        where: { id: messageId },
      });
      return { deletedMessageId: messageId };
    } else if (message.type === 'IMAGE') {
      // Update message content (e.g. "3 photos" -> "2 photos")
      const updatedMessage = await this.prisma.message.update({
        where: { id: messageId },
        data: { content: `${remainingImages.length} photos` },
        include: {
          sender: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
            },
          },
          images: true,
          replyTo: {
            include: {
              sender: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                },
              },
            },
          },
        },
      });
      return { updatedMessage: await this.signMessage(updatedMessage) };
    }

    return { success: true };
  }

  /**
   * ✅ P1.4: Delete individual message by user (GDPR Article 17 - Right to erasure)
   * REDACTS the message instead of physical deletion (for legal compliance)
   */
  async deleteMessageByUser(
    chatId: number,
    messageId: number,
    userId: number,
  ): Promise<void> {
    // 1. Verify message exists and belongs to user
    const message: any = await this.prisma.message.findFirst({
      where: {
        id: messageId,
        chatId,
        senderId: userId,
      },
      include: {
        images: true,
        reports: {
          where: {
            status: { in: ['PENDING', 'INVESTIGATING'] as any[] },
          },
        },
      },
    });

    if (!message) {
      throw new NotFoundException(
        'Message not found or you are not authorized to delete it',
      );
    }

    // 2. Check for active reports (strict policy: refuse deletion if reported)
    if (message.reports && message.reports.length > 0) {
      throw new ForbiddenException(
        'Cannot delete message linked to an active report',
      );
    }

    // 3. Collect S3 keys to delete
    const s3Keys: string[] = [];

    // FileUrl (legacy single file attachment)
    if (message.fileUrl) {
      const key = this.extractS3Key(message.fileUrl);
      if (key) s3Keys.push(key);
    }

    // MessageImg (multiple images)
    if (message.images) {
      for (const img of message.images) {
        const key = this.extractS3Key(img.url);
        if (key) s3Keys.push(key);
      }
    }

    // 4. Transaction: Delete MessageImgs + Redact Message
    await this.prisma.$transaction(async (tx) => {
      // Delete all images associated with the message
      if (message.images && message.images.length > 0) {
        await tx.messageImg.deleteMany({
          where: { messageId },
        });
      }

      // Redact message (keep row for chat history integrity)
      await tx.message.update({
        where: { id: messageId },
        data: {
          content: 'Message supprimé par l\'utilisateur',
          fileUrl: null,
          isDeleted: true,
          deletedAt: new Date(),
          redactedAt: new Date(),
          redactionReason: 'USER_DELETE',
          isEdited: true, // Mark as modified
          editedAt: new Date(),
        },
      });
    });

    // 5. Delete S3 files (after DB success)
    if (s3Keys.length > 0) {
      try {
        await this.s3Service.deleteFiles(s3Keys);
      } catch (err) {
        console.error(
          `[ChatService] Failed to delete S3 files for message ${messageId}:`,
          err.message,
        );
        // Don't throw - message is already redacted in DB
      }
    }
  }
}
