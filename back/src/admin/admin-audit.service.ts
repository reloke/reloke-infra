import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AdminAuditAction } from '@prisma/client';
import { Request } from 'express';

export interface AuditLogParams {
  adminId: number;
  adminEmail: string;
  action: AdminAuditAction;
  targetUserId?: number;
  targetUserUid?: string;
  metadata?: Record<string, unknown>;
  request?: Request;
}

@Injectable()
export class AdminAuditService {
  private readonly logger = new Logger(AdminAuditService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Log an admin action for audit trail
   */
  async log(params: AuditLogParams): Promise<void> {
    try {
      const {
        adminId,
        adminEmail,
        action,
        targetUserId,
        targetUserUid,
        metadata,
        request,
      } = params;

      // Extract request context
      const ipAddress = request ? this.getClientIp(request) : null;
      const userAgent = request?.headers['user-agent'] || null;
      const requestId = (request?.headers['x-request-id'] as string) || null;

      await this.prisma.adminAuditLog.create({
        data: {
          adminId,
          adminEmail,
          action,
          targetUserId,
          targetUserUid,
          ipAddress,
          userAgent,
          requestId,
          metadata: metadata ? JSON.parse(JSON.stringify(metadata)) : undefined,
        },
      });

      this.logger.log(
        `Admin action logged: ${action} by ${adminEmail} (${adminId}) on user ${targetUserUid || targetUserId || 'N/A'}`,
      );
    } catch (error) {
      // Log error but don't throw - audit logging should not break the main flow
      this.logger.error(
        `Failed to log admin action: ${error.message}`,
        error.stack,
      );
    }
  }

  /**
   * Get recent audit logs for an admin
   */
  async getLogsByAdmin(adminId: number, limit = 100) {
    return this.prisma.adminAuditLog.findMany({
      where: { adminId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  /**
   * Get recent audit logs for a target user
   */
  async getLogsByTargetUser(userId: number, limit = 100) {
    return this.prisma.adminAuditLog.findMany({
      where: { targetUserId: userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  /**
   * Get all audit logs with pagination
   */
  async getAllLogs(page = 1, limit = 50) {
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.prisma.adminAuditLog.findMany({
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.adminAuditLog.count(),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Extract client IP from request, handling proxies
   */
  private getClientIp(request: Request): string | null {
    const xForwardedFor = request.headers['x-forwarded-for'];
    if (xForwardedFor) {
      const ips = Array.isArray(xForwardedFor)
        ? xForwardedFor[0]
        : xForwardedFor.split(',')[0];
      return ips.trim();
    }
    return request.ip || request.socket?.remoteAddress || null;
  }
}
