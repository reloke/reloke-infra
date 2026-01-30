import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  UseGuards,
  Request,
  ParseIntPipe,
  UseInterceptors,
  UploadedFiles,
  BadRequestException,
  Body,
  Req,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  FilesInterceptor,
  AnyFilesInterceptor,
} from '@nestjs/platform-express';
import { ChatService } from './chat.service';
import { S3Service } from '../home/services/s3.service';
import { ChatGateway } from './chat.gateway';

@Controller('chat')
@UseGuards(AuthGuard('jwt'))
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly s3Service: S3Service,
    private readonly chatGateway: ChatGateway,
  ) { }

  @Get('conversations')
  getConversations(
    @Request() req: any,
    @Query('limit') limit?: number,
    @Query('cursor') cursor?: number,
  ) {
    const parsedLimit = limit ? parseInt(String(limit), 10) : 50;
    const parsedCursor = cursor ? parseInt(String(cursor), 10) : undefined;
    return this.chatService.getConversations(
      req.user.userId,
      parsedLimit,
      parsedCursor,
    );
  }

  @Get('match-group/:matchGroupId')
  getChatByMatchGroupId(
    @Param('matchGroupId') matchGroupId: string,
    @Request() req: any,
  ) {
    return this.chatService.getChatByMatchGroupId(
      matchGroupId,
      req.user.userId,
    );
  }

  @Get('match-group/:matchGroupId/info')
  getMatchGroupInfo(@Param('matchGroupId') matchGroupId: string) {
    return this.chatService.getMatchGroupInfo(matchGroupId);
  }

  @Post('match-group/:matchGroupId/create')
  createChatForMatchGoroup(
    @Param('matchGroupId') matchGroupId: string,
    @Request() req: any,
  ) {
    return this.chatService.createChatForMatchGroup(matchGroupId, req.user.userId);
  }

  @Post('upload')
  @UseInterceptors(FilesInterceptor('files', 20))
  async uploadAttachment(
    @UploadedFiles() files: Express.Multer.File[],
    @Body('chatId') chatId: string,
    @Req() req: any,
  ) {
    console.log(
      `[ChatController] Received upload request. Files: ${files?.length}, chatId: ${chatId}`,
    );
    const userId = req.user.userId;
    await this.chatService.checkIfUserBanned(userId);

    if (!files || files.length === 0) {
      throw new BadRequestException('Aucun fichier fourni');
    }

    if (!chatId) {
      throw new BadRequestException('ID de la conversation manquant');
    }

    const chatIdNum = Number(chatId);

    // Verify user is part of the chat and chat is not READ_ONLY
    const chat = await this.chatService.getChatWithParticipants(chatIdNum);

    if (!chat || !chat.participants.some((p) => p.userId === userId)) {
      throw new BadRequestException(
        "Vous n'êtes pas autorisé à envoyer un fichier dans cette conversation",
      );
    }

    if (chat.status === 'READ_ONLY') {
      throw new BadRequestException('Cette conversation est en lecture seule');
    }

    // --- Rate Limiting (Quota) ---
    const quota = await this.chatService.getMessageQuota(chatIdNum, userId);
    if (quota.isBlocked) {
      throw new BadRequestException(
        `Limite d'envoi atteinte (${quota.count}/5). Attendez que vos correspondants lisent vos messages.`,
      );
    }

    const imageKeys: string[] = [];
    let firstKey = '';
    let firstMimeType = '';
    let firstOriginalName = '';

    try {
      for (const file of files) {
        const key = `chat/${chatId}/${Date.now()}_${file.originalname}`;
        console.log(
          `[ChatController] Uploading file to S3: ${key} (${file.mimetype})`,
        );
        const fileKey = await this.s3Service.uploadFile(
          file.buffer,
          key,
          file.mimetype,
        );

        if (file.mimetype.startsWith('image/')) {
          imageKeys.push(fileKey);
        }

        if (!firstKey) {
          firstKey = fileKey;
          firstMimeType = file.mimetype;
          firstOriginalName = file.originalname;
        }
      }
    } catch (err) {
      console.error('[ChatController] Error during S3 upload loop:', err);
      throw err;
    }

    const isImageBatch = imageKeys.length > 0;
    const messageType = isImageBatch ? 'IMAGE' : 'FILE';

    // Save message with keys
    const message = await this.chatService.saveMessage(
      chatIdNum,
      userId,
      isImageBatch ? `${imageKeys.length} photos` : firstOriginalName,
      messageType as any,
      isImageBatch ? undefined : firstKey,
      isImageBatch ? undefined : firstMimeType,
      imageKeys,
    );

    console.log(
      `[ChatController] Upload successful for chat ${chatIdNum}. Broadcasting via WebSocket...`,
    );
    try {
      await this.chatGateway.broadcastNewMessage(chat, message);
    } catch (wsErr) {
      console.error(
        '[ChatController] WebSocket broadcast failed but message was saved:',
        wsErr,
      );
    }

    return message;
  }

  @Get(':chatId/messages')
  getMessages(
    @Param('chatId', ParseIntPipe) chatId: number,
    @Request() req: any,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('cursor', new ParseIntPipe({ optional: true })) cursor?: number,
  ) {
    return this.chatService.getMessages(chatId, req.user.userId, limit, cursor);
  }

  @Post(':chatId/read')
  async markAsRead(
    @Param('chatId', ParseIntPipe) chatId: number,
    @Request() req: any,
  ) {
    const result = await this.chatService.markAsRead(chatId, req.user.userId);

    // Notify other participants that a read event occurred,
    // which might update their quota status
    const chat = await this.chatService.getChatWithParticipants(chatId);
    if (chat) {
      this.chatGateway.broadcastQuotaUpdate(chat);
    }

    return result;
  }

  @Get(':chatId/quota')
  getQuota(@Param('chatId', ParseIntPipe) chatId: number, @Request() req: any) {
    return this.chatService.getMessageQuota(chatId, req.user.userId);
  }

  @Get(':chatId/exit-flow')
  exitFlow(@Param('chatId', ParseIntPipe) chatId: number, @Request() req: any) {
    return this.chatService.exitFlow(chatId, req.user.userId);
  }

  @Post(':chatId/messages/delete')
  async deleteMessages(
    @Param('chatId', ParseIntPipe) chatId: number,
    @Body('messageIds') messageIds: number[],
    @Request() req: any,
  ) {
    await this.chatService.checkIfUserBanned(req.user.userId);
    const result = await this.chatService.deleteMessages(
      chatId,
      req.user.userId,
      messageIds,
    );

    if (result.deletedIds.length > 0) {
      // Broadcast deletion via WebSocket
      const chat = await this.chatService.getChatWithParticipants(chatId);
      if (chat) {
        this.chatGateway.broadcastMessagesDeleted(chat, result.deletedIds);
      }
    }

    return result;
  }

  /**
   * ✅ P1.4: DELETE individual message (GDPR Article 17 - Right to erasure)
   * RESTful endpoint for deleting a single message by ID
   */
  @Delete(':chatId/messages/:messageId')
  async deleteMessage(
    @Param('chatId', ParseIntPipe) chatId: number,
    @Param('messageId', ParseIntPipe) messageId: number,
    @Req() req: any,
  ) {
    await this.chatService.checkIfUserBanned(req.user.userId);
    await this.chatService.deleteMessageByUser(
      chatId,
      messageId,
      req.user.userId,
    );

    // Broadcast deletion via WebSocket (optional)
    const chat = await this.chatService.getChatWithParticipants(chatId);
    if (chat) {
      this.chatGateway.broadcastMessagesDeleted(chat, [messageId]);
    }

    return {
      success: true,
      message: 'Message supprimé',
    };
  }

  @Post(':chatId/messages/:messageId/images/:imageId/delete')
  async deleteImage(
    @Param('chatId', ParseIntPipe) chatId: number,
    @Param('messageId', ParseIntPipe) messageId: number,
    @Param('imageId', ParseIntPipe) imageId: number,
    @Request() req: any,
  ) {
    await this.chatService.checkIfUserBanned(req.user.userId);
    const result = await this.chatService.deleteImage(
      chatId,
      messageId,
      imageId,
      req.user.userId,
    );

    const chat = await this.chatService.getChatWithParticipants(chatId);
    if (chat) {
      if (result.deletedMessageId) {
        this.chatGateway.broadcastMessagesDeleted(chat, [
          result.deletedMessageId,
        ]);
      } else if (result.updatedMessage) {
        this.chatGateway.broadcastMessageUpdated(chat, result.updatedMessage);
      }
    }

    return result;
  }

  @Post(':chatId/contact')
  async sendContactMessage(
    @Param('chatId', ParseIntPipe) chatId: number,
    @Body()
    body: {
      matchGroupId: string;
      contactName: string;
      contactEmail: string;
      contactPhone: string;
      contactTargetUserId?: number;
    },
    @Request() req: any,
  ) {
    const userId = req.user.userId;
    await this.chatService.checkIfUserBanned(userId);

    // --- Rate Limiting (Quota) ---
    const quota = await this.chatService.getMessageQuota(chatId, userId);
    if (quota.isBlocked) {
      throw new BadRequestException(
        `Limite d'envoi atteinte (${quota.count}/5). Attendez que vos correspondants lisent vos messages.`,
      );
    }

    const message = await this.chatService.saveContactMessage(
      chatId,
      userId,
      body.matchGroupId,
      {
        name: body.contactName,
        email: body.contactEmail,
        phone: body.contactPhone,
        targetUserId: body.contactTargetUserId,
      },
    );

    const chat = await this.chatService.getChatWithParticipants(chatId);
    if (chat) {
      await this.chatGateway.broadcastNewMessage(chat, message);
      // broadcastNewMessage already calls broadcastQuotaUpdate in my latest update to ChatGateway
    }

    return message;
  }

  @Patch(':chatId/contact/:messageId')
  async updateContactMessage(
    @Param('chatId', ParseIntPipe) chatId: number,
    @Param('messageId', ParseIntPipe) messageId: number,
    @Body()
    body: { contactName: string; contactEmail: string; contactPhone: string },
    @Request() req: any,
  ) {
    const userId = req.user.userId;
    await this.chatService.checkIfUserBanned(userId);

    const message = await this.chatService.updateContactMessage(
      messageId,
      userId,
      {
        name: body.contactName,
        email: body.contactEmail,
        phone: body.contactPhone,
      },
    );

    const chat = await this.chatService.getChatWithParticipants(chatId);
    if (chat) {
      await this.chatGateway.broadcastMessageUpdated(chat, message);
    }

    return message;
  }

  @Get(':chatId/contacts')
  async getConversationContacts(
    @Param('chatId', ParseIntPipe) chatId: number,
    @Request() req: any,
  ) {
    return this.chatService.getConversationContacts(chatId, req.user.userId);
  }
}
