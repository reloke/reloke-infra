import { Injectable } from '@nestjs/common';
import { AuditEntityType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

interface Pagination {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export interface AuditLogList {
  items: any[];
  pagination: Pagination;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async findByEntity(
    entityType: AuditEntityType,
    entityId: number,
    page = 1,
    pageSize = 20,
  ): Promise<AuditLogList> {
    const where: Prisma.AuditLogWhereInput = {
      entityType,
      entityId,
    };
    return this.queryLogs(where, page, pageSize);
  }

  async findByUser(
    userId: number,
    entityType?: AuditEntityType,
    page = 1,
    pageSize = 20,
  ): Promise<AuditLogList> {
    const where: Prisma.AuditLogWhereInput = {
      userId,
      ...(entityType ? { entityType } : {}),
    };
    return this.queryLogs(where, page, pageSize);
  }

  private async queryLogs(
    where: Prisma.AuditLogWhereInput,
    page: number,
    pageSize: number,
  ): Promise<AuditLogList> {
    const totalItems = await this.prisma.auditLog.count({ where });
    const totalPages = Math.ceil(totalItems / pageSize);
    const items = await this.prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    return {
      items,
      pagination: {
        page,
        pageSize,
        totalItems,
        totalPages,
      },
    };
  }
}
