import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import { HelpService } from './help.service';
import { CreateHelpRequestDto } from './dto/create-help-request.dto';
import {
  HelpRequestDto,
  HelpRequestListItemDto,
  PaginatedHelpRequestsDto,
} from './dto/help-request.dto';

@Controller('help')
@UseGuards(AuthGuard('jwt'))
export class HelpController {
  constructor(private readonly helpService: HelpService) {}

  /**
   * POST /help/upload
   * Upload a single attachment file
   */
  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async uploadAttachment(
    @Request() req,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<{ key: string }> {
    if (!file) {
      throw new BadRequestException('Aucun fichier fourni');
    }
    return this.helpService.uploadAttachment(req.user.userId, file);
  }

  /**
   * POST /help/requests
   * Create a new help request
   */
  @Post('requests')
  async createHelpRequest(
    @Request() req,
    @Body() dto: CreateHelpRequestDto,
  ): Promise<HelpRequestDto> {
    return this.helpService.createHelpRequest(req.user.userId, dto);
  }

  /**
   * GET /help/requests
   * Get user's help requests list
   */
  @Get('requests')
  async getUserHelpRequests(@Request() req): Promise<HelpRequestListItemDto[]> {
    return this.helpService.getUserHelpRequests(req.user.userId);
  }

  /**
   * GET /help/requests/paginated
   * Get user's help requests list (cursor pagination)
   */
  @Get('requests/paginated')
  async getUserHelpRequestsPaginated(
    @Request() req,
    @Query('cursor') cursor?: string,
    @Query('take') take?: string,
  ): Promise<PaginatedHelpRequestsDto> {
    const parsedTake = take ? Number.parseInt(take, 10) : 10;
    const safeTake = Number.isFinite(parsedTake)
      ? Math.min(Math.max(parsedTake, 1), 50)
      : 10;

    const parsedCursor = cursor ? Number.parseInt(cursor, 10) : undefined;
    const safeCursor =
      cursor && Number.isFinite(parsedCursor) ? parsedCursor : undefined;

    return this.helpService.getUserHelpRequestsPaginated(req.user.userId, {
      cursor: safeCursor,
      take: safeTake,
    });
  }

  /**
   * GET /help/requests/:uid
   * Get a specific help request details
   */
  @Get('requests/:uid')
  async getUserHelpRequest(
    @Request() req,
    @Param('uid') uid: string,
  ): Promise<HelpRequestDto> {
    return this.helpService.getUserHelpRequest(req.user.userId, uid);
  }
}
