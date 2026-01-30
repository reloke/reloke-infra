import {
  Controller,
  Get,
  Query,
  Param,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { AuditService } from './audit.service';
import { AuditEntityType } from '@prisma/client';
import { AuthGuard } from '@nestjs/passport';

@Controller('audit')
@UseGuards(AuthGuard('jwt'))
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  findByEntity(
    @Query('entityType') entityType: AuditEntityType,
    @Query('entityId', ParseIntPipe) entityId: number,
    @Query('page') page = 1,
    @Query('pageSize') pageSize = 20,
  ) {
    return this.auditService.findByEntity(
      entityType,
      entityId,
      Number(page) || 1,
      Number(pageSize) || 20,
    );
  }

  @Get('user/:userId')
  findByUser(
    @Param('userId', ParseIntPipe) userId: number,
    @Query('entityType') entityType?: AuditEntityType,
    @Query('page') page = 1,
    @Query('pageSize') pageSize = 20,
  ) {
    return this.auditService.findByUser(
      userId,
      entityType,
      Number(page) || 1,
      Number(pageSize) || 20,
    );
  }
}
