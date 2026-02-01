import {
  WebSocketGateway,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { UseGuards, Logger, Inject, forwardRef } from '@nestjs/common';
import { ChatService } from './chat.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { NotificationService } from '../notification/notification.service';
import { RedisService } from '../redis/redis.service';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';

@WebSocketGateway({
  cors: {
    origin: (origin, callback) => {
      // Dynamic CORS: allow localhost in dev + FRONTEND_URL in prod
      // The actual FRONTEND_URL check is done in afterInit for access to ConfigService
      if (
        !origin ||
        /localhost:\d+$/.test(origin) ||
        /127\.0\.0\.1:\d+$/.test(origin)
      ) {
        callback(null, true);
      } else {
        // Will be checked against FRONTEND_URL in afterInit override
        callback(null, true); // Allow all initially, real check done at connection auth level
      }
    },
    credentials: true,
  },
  namespace: 'chat',
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(ChatGateway.name);

  constructor(
    private chatService: ChatService,
    private jwtService: JwtService,
    private configService: ConfigService,
    @Inject(forwardRef(() => NotificationService))
    private notificationService: NotificationService,
    private redisService: RedisService,
    private mailService: MailService,
    private prisma: PrismaService,
  ) { }

  afterInit(server: Server) {
    // Override CORS with dynamic FRONTEND_URL from config
    const frontendUrl = this.configService.get<string>('FRONTEND_URL');
    if (frontendUrl) {
      const allowedOrigins = [
        /localhost:\d+$/,
        /127\.0\.0\.1:\d+$/,
        frontendUrl,
      ];
      (server as any).engine?.on('headers', () => {
        /* noop */
      });
      // Update the CORS origin dynamically
      const opts = (server as any)?.opts;
      if (opts?.cors) {
        opts.cors.origin = allowedOrigins;
        this.logger.log(
          `WebSocket CORS updated with FRONTEND_URL: ${frontendUrl}`,
        );
      }
    }
  }

  async handleConnection(client: Socket) {
    this.logger.log(`Connection attempt: client ${client.id}`);
    try {
      let token =
        client.handshake.auth?.token || client.handshake.headers?.authorization;
      this.logger.debug(
        `Initial token check: ${token ? 'Found in auth/headers' : 'Not found'}`,
      );

      // Support for Cookies if no token in auth/headers
      if (!token && client.handshake.headers?.cookie) {
        token = this.extractTokenFromCookie(client.handshake.headers.cookie);
        this.logger.debug(
          `Cookie token check: ${token ? 'Found in cookies' : 'Not found'}`,
        );
      }

      if (!token) {
        this.logger.warn(
          `Connection denied: No token found for client ${client.id}`,
        );
        client.disconnect();
        return;
      }

      const cleanToken = token.replace('Bearer ', '');
      const secret = this.configService.get('JWT_SECRET');
      if (!secret) {
        this.logger.error(
          'JWT_SECRET is not configured. Rejecting WebSocket connection.',
        );
        client.disconnect();
        return;
      }

      const payload = await this.jwtService.verifyAsync(cleanToken, {
        secret: secret,
      });

      const userId = Number(payload.sub);
      if (!userId) {
        this.logger.warn(
          `Connection denied: Invalid user ID (sub) in token for client ${client.id}`,
        );
        client.disconnect();
        return;
      }

      client.data.userId = userId;

      // Join a personal room for notifications
      client.join(`user_${userId}`);

      this.logger.log(`Client authenticated: ${client.id} (User: ${userId})`);

      // Join all chat rooms the user is part of (lightweight query, no unread counts)
      const participations = await this.chatService.getUserChatRooms(userId);
      this.logger.debug(
        `User ${userId} joining ${participations.length} chat rooms`,
      );
      for (const p of participations) {
        const roomName = p.matchGroupId
          ? `chat_${p.matchGroupId}`
          : `chat_${p.chatId}`;
        client.join(roomName);
      }
    } catch (e) {
      this.logger.error(
        `Connection authentication failed for client ${client.id}: ${e.message}`,
      );
      client.disconnect();
    }
  }

  private extractTokenFromCookie(cookieString: string): string | null {
    if (!cookieString) return null;
    const cookies = cookieString.split(';').reduce((acc, cookie) => {
      const [key, value] = cookie.split('=').map((c) => c.trim());
      acc[key] = value;
      return acc;
    }, {} as any);
    return cookies['__session_access_token'] || null;
  }

  async handleDisconnect(client: Socket) {
    const userId = client.data?.userId;
    this.logger.log(
      `Client disconnected: ${client.id} (User: ${userId || 'unknown'})`,
    );

    if (userId) {
      // Get all chat rooms the client was in
      const rooms = Array.from(client.rooms);
      const chatRooms = rooms.filter((room) => room.startsWith('chat_'));

      // Remove each chat room from the active_rooms SET
      if (chatRooms.length > 0) {
        await this.redisService
          .srem(`active_rooms:${userId}`, ...chatRooms)
          .catch(() => { });
        this.logger.debug(
          `Cleaned up ${chatRooms.length} rooms for user ${userId}: ${chatRooms.join(', ')}`,
        );
      }
    }
  }

  @SubscribeMessage('sendMessage')
  async handleMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      chatId: number;
      matchGroupId?: string;
      content: string;
      type?: any;
      replyToId?: number;
    },
  ) {
    const userId = client.data.userId;
    this.logger.debug(`[ChatGateway] handleMessage called by user ${userId}`);

    // Check if user is banned
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { status: true, isBanned: true, isLocked: true },
    });

    this.logger.debug(
      `[ChatGateway] Ban check for user ${userId}: status=${user?.status}, isBanned=${user?.isBanned}, isLocked=${user?.isLocked}`,
    );

    if (user && (user.status === 'BANNED' || user.isBanned || user.isLocked)) {
      this.logger.warn(
        `[ChatGateway] Blocked message from banned user ${userId}`,
      );
      return {
        event: 'error',
        data: 'Votre compte est suspendu. Vous ne pouvez pas envoyer de messages.',
      };
    }

    // --- Content validation ---
    const content = (data.content || '').trim();
    if (!content && (!data.type || data.type === 'TEXT')) {
      return { event: 'error', data: 'Le message ne peut pas être vide' };
    }
    if (content.length > 5000) {
      return {
        event: 'error',
        data: 'Le message dépasse la limite de 5000 caractères',
      };
    }
    // Strip HTML tags to prevent stored XSS
    const sanitizedContent = content.replace(/<[^>]*>/g, '');

    // Fetch chat by ID or matchGroupId
    let chat;
    if (data.matchGroupId) {
      chat = await this.chatService.getChatByMatchGroupId(
        data.matchGroupId,
        userId,
      );
    } else {
      // Lightweight lookup instead of loading all conversations
      chat = await this.chatService.getChatForSend(data.chatId, userId);
    }

    if (!chat) return { event: 'error', data: 'Chat not found' };

    // Check for READ_ONLY status
    if (chat.status === 'READ_ONLY') {
      return {
        event: 'error',
        data: 'This conversation is read-only. You cannot send messages.',
      };
    }

    // --- Rate Limiting (Quota) ---
    const quota = await this.chatService.getMessageQuota(chat.id, userId);
    if (quota.isBlocked) {
      return {
        event: 'error',
        data: `Limite d'envoi atteinte (${quota.count}/5). Attendez que vos correspondants lisent vos messages.`,
      };
    }

    const message = await this.chatService.saveMessage(
      chat.id,
      userId,
      sanitizedContent,
      data.type,
      undefined,
      undefined,
      undefined,
      data.replyToId,
    );

    // Fetch participants for direct targeted emission
    const chatWithParticipants = await this.chatService.getChatWithParticipants(
      chat.id,
    );
    if (!chatWithParticipants) {
      this.logger.error(
        `Could not find chat ${chat.id} with participants for broadcast`,
      );
      return;
    }
    const participants = chatWithParticipants.participants;

    // Construct target rooms for redundancy: Chat Room + Each User's Room
    const roomsToEmit = new Set<string>();
    if (chat.matchGroupId) roomsToEmit.add(`chat_${chat.matchGroupId}`);
    roomsToEmit.add(`chat_${chat.id}`);
    for (const p of participants) {
      roomsToEmit.add(`user_${p.userId}`);
    }

    const roomArray = Array.from(roomsToEmit);
    this.logger.debug(
      `[ChatGateway] Broadcasting message ${message.id} to rooms: ${roomArray.join(', ')}`,
    );

    // Targeted emission to all relevant rooms
    this.server.to(roomArray).emit('newMessage', message);

    // Update quota for the sender immediately
    this.broadcastQuotaUpdate(chatWithParticipants);

    await this.sendNewMessageNotifications(
      chat,
      message,
      userId,
      sanitizedContent || 'Nouveau message',
    );

    // Return success acknowledgment to the sender
    return { success: true, message };
  }

  @SubscribeMessage('editMessage')
  async handleEditMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { messageId: number; content: string },
  ) {
    const userId = client.data.userId;

    // Check if user is banned
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { status: true, isBanned: true, isLocked: true },
    });

    if (user && (user.status === 'BANNED' || user.isBanned || user.isLocked)) {
      return {
        event: 'error',
        data: 'Votre compte est suspendu. Vous ne pouvez pas modifier de messages.',
      };
    }

    try {
      const message = await this.chatService.updateMessage(
        data.messageId,
        userId,
        data.content,
      );

      const chat = await this.chatService.getChatWithParticipants(
        message.chatId,
      );
      if (!chat) return;

      const roomsToEmit = new Set<string>();
      if (chat.matchGroupId) roomsToEmit.add(`chat_${chat.matchGroupId}`);
      roomsToEmit.add(`chat_${chat.id}`);
      for (const p of chat.participants) {
        roomsToEmit.add(`user_${p.userId}`);
      }

      const roomArray = Array.from(roomsToEmit);
      this.server.to(roomArray).emit('messageUpdated', message);

      return { event: 'messageUpdated', data: message };
    } catch (e) {
      return { event: 'error', data: e.message };
    }
  }

  @SubscribeMessage('deleteMessage')
  async handleDeleteOneMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { chatId: number; messageId: number },
  ) {
    const userId = client.data.userId;

    // Check if user is banned
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { status: true, isBanned: true, isLocked: true },
    });

    if (user && (user.status === 'BANNED' || user.isBanned || user.isLocked)) {
      return {
        event: 'error',
        data: 'Votre compte est suspendu. Vous ne pouvez pas supprimer de messages.',
      };
    }

    try {
      const result = await this.chatService.deleteMessages(
        data.chatId,
        userId,
        [data.messageId],
      );

      if (result.deletedIds.length === 0) return;

      const chat = await this.chatService.getChatWithParticipants(data.chatId);
      if (!chat) return;

      const roomsToEmit = new Set<string>();
      if (chat.matchGroupId) roomsToEmit.add(`chat_${chat.matchGroupId}`);
      roomsToEmit.add(`chat_${chat.id}`);
      for (const p of chat.participants) {
        roomsToEmit.add(`user_${p.userId}`);
      }

      const roomArray = Array.from(roomsToEmit);
      this.server.to(roomArray).emit('messagesDeleted', {
        chatId: data.chatId,
        messageIds: result.deletedIds,
      });

      return {
        event: 'messagesDeleted',
        data: { chatId: data.chatId, messageIds: result.deletedIds },
      };
    } catch (e) {
      return { event: 'error', data: e.message };
    }
  }

  private async sendNewMessageNotifications(
    chat: any,
    message: any,
    senderId: number,
    content: string,
  ) {
    const roomName = chat.matchGroupId
      ? `chat_${chat.matchGroupId}`
      : `chat_${chat.id}`;

    // --- Notification Logic ---
    const chatWithParticipants = await this.chatService.getChatWithParticipants(
      chat.id,
    );
    if (!chatWithParticipants) return;

    const sender = chatWithParticipants.participants.find(
      (p) => p.userId === senderId,
    )?.user;
    const senderName = sender
      ? `${sender.firstName} ${sender.lastName}`
      : "Quelqu'un";

    this.logger.debug(
      `Found ${chatWithParticipants.participants.length} participants for notification check`,
    );

    for (const participant of chatWithParticipants.participants) {
      if (participant.userId === senderId) continue;

      // Check if user is active in ANY room that matches this chat (supports multi-tabs)
      const matchGroupRoom = `chat_${chat.matchGroupId}`;
      const chatIdRoom = `chat_${chat.id}`;

      const isActiveInMatchRoom = await this.redisService.sismember(
        `active_rooms:${participant.userId}`,
        matchGroupRoom,
      );
      const isActiveInChatRoom = await this.redisService.sismember(
        `active_rooms:${participant.userId}`,
        chatIdRoom,
      );
      const isActive = isActiveInMatchRoom || isActiveInChatRoom;

      this.logger.debug(
        `Checking participant ${participant.userId} (SNDR: ${senderId}) | Active: ${isActive} | TargetRooms: ${matchGroupRoom}, ${chatIdRoom}`,
      );

      if (!isActive) {
        this.logger.log(
          `User ${participant.userId} NOT active in current chat room. Sending notification.`,
        );

        const isContact = message.type === 'CONTACT';
        const notificationTitle = isContact
          ? `Nouveau contact de ${senderName}`
          : `${senderName} vous a envoyé un message`;

        const notificationContent = isContact
          ? `${senderName} a partagé les coordonnées du gestionnaire ${message.contactName}`
          : `${senderName} vous a envoyé un message`;

        // Persistent notification & Real-time emit (service handled)
        await this.notificationService.createNotification(
          participant.userId,
          'MESSAGE',
          notificationContent,
          {
            matchGroupId: chat.matchGroupId,
            chatId: chat.id,
            isContact: isContact,
            contactName: message.contactName,
          },
        );

        // Browser Push Notification (Background)
        let pushSuccess = false;
        try {
          pushSuccess = await this.notificationService.sendPushNotification(
            participant.userId,
            notificationTitle,
            isContact ? notificationContent : content,
            { matchGroupId: chat.matchGroupId, chatId: chat.id },
          );
        } catch (pushErr) {
          this.logger.error(
            `Push notification failed for user ${participant.userId}`,
            pushErr,
          );
        }

        // --- Email Notification Logic (Only if offline AND no push sent) ---
        if (!pushSuccess) {
          try {
            // Check if user has any active sockets
            const userSockets = await this.server
              .in(`user_${participant.userId}`)
              .fetchSockets();
            const isTrulyOffline = userSockets.length === 0;

            if (isTrulyOffline) {
              this.logger.log(
                `User ${participant.userId} is TRULY OFFLINE and NO PUSH sent. Sending email.`,
              );

              if (isContact) {
                await this.mailService.sendContactSharedEmail(
                  participant.user.mail,
                  participant.user.firstName || 'Utilisateur',
                  senderName,
                  message.contactName,
                  chat.id,
                  chat.matchGroupId,
                );
              } else {
                let textToShow = content;
                if (message.type === 'IMAGE')
                  textToShow = "📷 L'utilisateur vous a envoyé une image";
                else if (message.type === 'FILE')
                  textToShow = "📎 L'utilisateur vous a envoyé un fichier";

                // Fallback if content is somehow still empty
                if (!textToShow || textToShow.trim() === '')
                  textToShow = 'Nouveau message reçu';

                const messagePreview =
                  textToShow.length > 100
                    ? textToShow.substring(0, 97) + '...'
                    : textToShow;

                await this.mailService.sendNewMessageNotificationEmail(
                  participant.user.mail,
                  participant.user.firstName || 'Utilisateur',
                  senderName,
                  messagePreview,
                  chat.id,
                  chat.matchGroupId,
                );
              }
            }
          } catch (mailErr) {
            this.logger.error(
              `Email notification failed for user ${participant.userId}`,
              mailErr,
            );
          }
        } else {
          this.logger.debug(
            `Push notification successful for user ${participant.userId}. Skipping email.`,
          );
        }
      }
    }
  }

  @SubscribeMessage('enterRoom')
  async handleEnterRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomName: string },
  ) {
    const userId = client.data.userId;
    // Use Redis SET to support multiple tabs
    await this.redisService.sadd(`active_rooms:${userId}`, data.roomName);
    await this.redisService.setExpire(`active_rooms:${userId}`, 3600); // 1h TTL
    this.logger.debug(`User ${userId} entered room ${data.roomName}`);

    // Mark notifications as read when entering room
    if (data.roomName.startsWith('chat_')) {
      const matchGroupId = data.roomName.replace('chat_', '');
      await this.notificationService.markAllAsRead(userId, matchGroupId);
    }
  }

  @SubscribeMessage('leaveRoom')
  async handleLeaveRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomName: string },
  ) {
    const userId = client.data.userId;
    // Remove only the specific room from the SET
    await this.redisService.srem(`active_rooms:${userId}`, data.roomName);
    this.logger.debug(`User ${userId} left room ${data.roomName}`);
  }

  @SubscribeMessage('typing')
  async handleTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: { chatId: number; matchGroupId?: string; isTyping: boolean },
  ) {
    const userId = client.data.userId;
    if (!userId) return;

    // Check if user is banned (cached or simple check to avoid DB hit every typing event,
    // but here we follow the pattern for consistency)
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { status: true, isBanned: true, isLocked: true },
    });

    if (user && (user.status === 'BANNED' || user.isBanned || user.isLocked)) {
      return;
    }

    const roomName = data.matchGroupId
      ? `chat_${data.matchGroupId}`
      : `chat_${data.chatId}`;

    // Broadcast to others in the room
    client.to(roomName).emit('userTyping', {
      chatId: data.chatId,
      matchGroupId: data.matchGroupId,
      userId,
      isTyping: data.isTyping,
    });
  }

  // Allow other services/controllers to broadcast messages
  async broadcastNewMessage(chat: any, message: any) {
    if (!this.server) {
      this.logger.error(
        'Cannot broadcast: WebSocket server instance not initialized',
      );
      return;
    }

    // Get participants
    const chatWithParticipants = chat.participants
      ? chat
      : await this.chatService.getChatWithParticipants(chat.id);
    if (!chatWithParticipants) {
      this.logger.error(
        `Could not find chat ${chat.id} for broadcastNewMessage`,
      );
      return;
    }
    const participants = chatWithParticipants.participants;

    // Redundant broadcasting: Chat Rooms + User Rooms
    const roomsToEmit = new Set<string>();
    if (chat.matchGroupId) roomsToEmit.add(`chat_${chat.matchGroupId}`);
    roomsToEmit.add(`chat_${chat.id}`);
    for (const p of participants) {
      roomsToEmit.add(`user_${p.userId}`);
    }

    const roomArray = Array.from(roomsToEmit);
    this.logger.debug(
      `Broadcasting message ${message.id} to: ${roomArray.join(', ')}`,
    );

    this.server.to(roomArray).emit('newMessage', message);

    // Update quota for all participants (especially the sender)
    this.broadcastQuotaUpdate(chatWithParticipants);

    // Also trigger notifications (push/persistent)
    await this.sendNewMessageNotifications(
      chat,
      message,
      message.senderId,
      'Pièce jointe',
    );
  }

  notifyUserReported(userId: number) {
    // Notification removed as per requirements: "enlever la notification au/aux signalé(s)"
    this.logger.debug(`User ${userId} was reported. (Notification disabled)`);
  }

  notifyUserBanned(userId: number) {
    if (this.server) {
      this.server.to(`user_${userId}`).emit('userBanned', { userId });
    }
  }

  @SubscribeMessage('joinChat')
  async handleJoinChat(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { chatId?: number; matchGroupId?: string },
  ) {
    const userId = client.data.userId;
    let roomName: string;

    if (data.matchGroupId) {
      const chat = await this.chatService.getChatByMatchGroupId(
        data.matchGroupId,
        userId,
      );
      if (!chat) return { event: 'error', data: 'Chat not found' };
      roomName = `chat_${data.matchGroupId}`;
    } else if (data.chatId) {
      const isParticipant = await this.chatService.isParticipant(
        data.chatId,
        userId,
      );
      if (!isParticipant) return { event: 'error', data: 'Not a participant' };
      roomName = `chat_${data.chatId}`;
    } else {
      return { event: 'error', data: 'No chatId or matchGroupId provided' };
    }

    client.join(roomName);
    this.logger.debug(`User ${userId} joined room ${roomName}`);
    return { event: 'joined', data: roomName };
  }

  @SubscribeMessage('checkConnectivity')
  handleCheckConnectivity(@ConnectedSocket() client: Socket) {
    const userId = client.data.userId;
    const rooms = Array.from(client.rooms);
    this.logger.debug(
      `Connectivity check for user ${userId}. Connected: true. Rooms: ${rooms.join(', ')}`,
    );
    return { status: 'connected', userId, rooms };
  }

  async broadcastMessagesDeleted(chat: any, messageIds: number[]) {
    if (!this.server) return;

    const roomsToEmit = new Set<string>();
    if (chat.matchGroupId) roomsToEmit.add(`chat_${chat.matchGroupId}`);
    roomsToEmit.add(`chat_${chat.id}`);

    const participants = chat.participants || [];
    for (const p of participants) {
      roomsToEmit.add(`user_${p.userId}`);
    }

    const roomArray = Array.from(roomsToEmit);
    this.server
      .to(roomArray)
      .emit('messagesDeleted', { chatId: chat.id, messageIds });
  }

  async broadcastMessageUpdated(chat: any, message: any) {
    if (!this.server) return;

    const roomsToEmit = new Set<string>();
    if (chat.matchGroupId) roomsToEmit.add(`chat_${chat.matchGroupId}`);
    roomsToEmit.add(`chat_${chat.id}`);

    const participants = chat.participants || [];
    for (const p of participants) {
      roomsToEmit.add(`user_${p.userId}`);
    }

    const roomArray = Array.from(roomsToEmit);
    this.server.to(roomArray).emit('messageUpdated', message);

    // --- Notification for Contact Updates ---
    if (message.type === 'CONTACT') {
      const senderName = message.sender
        ? `${message.sender.firstName} ${message.sender.lastName}`
        : 'Votre correspondant';

      for (const participant of participants) {
        if (participant.userId === message.senderId) continue;

        // Check if user is active in ANY room that matches this chat (supports multi-tabs)
        const matchGroupRoom = `chat_${chat.matchGroupId}`;
        const chatIdRoom = `chat_${chat.id}`;
        const isActiveInMatchRoom = await this.redisService.sismember(
          `active_rooms:${participant.userId}`,
          matchGroupRoom,
        );
        const isActiveInChatRoom = await this.redisService.sismember(
          `active_rooms:${participant.userId}`,
          chatIdRoom,
        );
        const isActive = isActiveInMatchRoom || isActiveInChatRoom;

        if (!isActive) {
          const content = `${senderName} a mis à jour les coordonnées du gestionnaire ${message.contactName}`;

          await this.notificationService.createNotification(
            participant.userId,
            'MESSAGE',
            content,
            {
              matchGroupId: chat.matchGroupId,
              chatId: chat.id,
              isContactUpdate: true,
              contactName: message.contactName,
            },
          );

          // Offline email for update
          const userSockets = await this.server
            .in(`user_${participant.userId}`)
            .fetchSockets();
          if (userSockets.length === 0) {
            await this.mailService.sendContactUpdatedEmail(
              participant.user.mail,
              participant.user.firstName || 'Utilisateur',
              senderName,
              message.contactName,
              chat.id,
              chat.matchGroupId,
            );
          }
        }
      }
    }
  }

  emitNotification(userId: number, notification: any) {
    if (this.server) {
      this.server.to(`user_${userId}`).emit('newNotification', notification);
    }
  }

  /**
   * Broadcast quota update to all participants in a chat.
   * This is called when a message is sent or when someone marks a chat as read.
   */
  async broadcastQuotaUpdate(chat: any) {
    if (!this.server) return;

    const chatWithParticipants = chat.participants
      ? chat
      : await this.chatService.getChatWithParticipants(chat.id);
    if (!chatWithParticipants) return;

    for (const participant of chatWithParticipants.participants) {
      const quota = await this.chatService.getMessageQuota(
        chat.id,
        participant.userId,
      );
      this.server.to(`user_${participant.userId}`).emit('quotaUpdate', {
        chatId: chat.id,
        ...quota,
      });
    }
  }
}
