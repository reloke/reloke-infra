import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  Request,
  Param,
  ParseIntPipe,
  Query,
  Delete,
  DefaultValuePipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { NotificationService } from './notification.service';

@Controller('notifications')
@UseGuards(AuthGuard('jwt'))
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Get()
  getNotifications(
    @Request() req,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.notificationService.getUserNotifications(
      req.user.userId,
      page,
      limit,
    );
  }

  @Get('unread-count')
  getUnreadCount(@Request() req) {
    return this.notificationService.getUnreadCount(req.user.userId);
  }

  @Post('subscribe')
  addSubscription(@Request() req, @Body() subscription: any) {
    return this.notificationService.addSubscription(
      req.user.userId,
      subscription,
    );
  }

  @Post('mark-read')
  markAllAsRead(@Request() req, @Body() body: { matchGroupId?: string }) {
    return this.notificationService.markAllAsRead(
      req.user.userId,
      body.matchGroupId,
    );
  }

  @Post(':id/read')
  markAsRead(@Param('id', ParseIntPipe) id: number) {
    return this.notificationService.markAsRead(id);
  }

  @Delete(':id')
  deleteNotification(@Request() req, @Param('id', ParseIntPipe) id: number) {
    return this.notificationService.deleteNotification(req.user.userId, id);
  }

  @Delete()
  deleteAll(@Request() req) {
    return this.notificationService.deleteAllNotifications(req.user.userId);
  }
}
