import {
  Controller,
  Get,
  Patch,
  Post,
  Delete,
  Body,
  UseGuards,
  Req,
  UseInterceptors,
  UploadedFile,
  Res,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { UserService } from './user.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { Express } from 'express';
import { Multer } from 'multer';

// import { diskStorage } from 'multer'; // Configure if needed

@Controller('user')
@UseGuards(JwtAuthGuard)
export class UserController {
  constructor(private readonly userService: UserService) { }

  @Patch('profile')
  async updateProfile(
    @Req() req,
    @Body() data: { firstName: string; lastName: string },
  ) {
    return this.userService.updateProfile(req.user.userId, data);
  }

  @Patch('push-settings')
  async updatePushSettings(
    @Req() req,
    @Body() data: { pushEnabled: boolean },
  ) {
    return this.userService.updatePushSettings(req.user.userId, data.pushEnabled);
  }

  @Post('upload-identity')
  @UseInterceptors(
    FileInterceptor('file', {
      dest: './uploads/identity-proofs', // Ensure this directory exists
      limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    }),
  )
  async uploadIdentity(@Req() req, @UploadedFile() file: any) {
    // Temporary fix for global Express.Multer type issue
    return this.userService.uploadIdentityProof(req.user.userId, file);
  }

  @Get('export-data')
  async exportData(@Req() req, @Res() res: Response) {
    return this.userService.exportUserData(req.user.userId, res);
  }

  @Post('delete-request')
  @HttpCode(HttpStatus.TEMPORARY_REDIRECT)
  async requestDeletion(@Req() req, @Res() res: Response) {
    // Redirect to unified GDPR endpoint
    return res.redirect(307, '/v1/me/delete-account');
  }

  @Post('cancel-delete-request')
  @HttpCode(HttpStatus.TEMPORARY_REDIRECT)
  async cancelDeletion(@Req() req, @Res() res: Response) {
    // Redirect to unified GDPR endpoint
    return res.redirect(307, '/v1/me/cancel-delete-account');
  }

  @Get('deletion-precheck')
  async getDeletionPrecheck(@Req() req) {
    return this.userService.getDeletionPrecheck(req.user.userId);
  }
}
