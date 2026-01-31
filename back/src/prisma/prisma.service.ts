import { Injectable, OnModuleInit } from '@nestjs/common';
import {
  AuditAction,
  AuditEntityType,
  AuditSource,
  Prisma,
  PrismaClient,
} from '@prisma/client';
import { RequestContextService } from '../common/request-context.service';
import { AsyncLocalStorage } from 'async_hooks';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  private readonly auditBypass = new AsyncLocalStorage<boolean>();

  constructor(private readonly requestContext: RequestContextService, private readonly configService: ConfigService) {
    super();
    this.registerAuditMiddleware();
  }

  async onModuleInit() {
    await this.$connect();
  }

  private registerAuditMiddleware() {
    const prisma = this;
    const auditedModels: AuditEntityType[] = [
      AuditEntityType.Home,
      AuditEntityType.Search,
      AuditEntityType.Intent,
      AuditEntityType.SearchAdress,
    ];

    prisma.$use(async (params, next) => {
      if (this.auditBypass.getStore()) {
        return next(params);
      }

      const model = params.model as AuditEntityType | undefined;
      const action = params.action;

      if (!model || !auditedModels.includes(model)) {
        return next(params);
      }

      const isBulkCreate =
        model === AuditEntityType.SearchAdress && action === 'createMany';
      const isBulkDelete =
        model === AuditEntityType.SearchAdress && action === 'deleteMany';

      if (
        !['create', 'update', 'delete'].includes(action) &&
        !isBulkCreate &&
        !isBulkDelete
      ) {
        return next(params);
      }

      const whereArg = params.args?.where;
      let before: Record<string, any> | null = null;

      const ctx = this.requestContext.get();

      if (isBulkDelete) {
        before = await this.runWithoutAudit(() =>
          prisma.searchAdress.findMany({
            where: params.args?.where,
          }),
        );
      } else if (action === 'update' || action === 'delete') {
        if (whereArg) {
          before = await this.runWithoutAudit(() =>
            (prisma as any)[model].findUnique({ where: whereArg }),
          );
        }
      }

      const result = await next(params);
      const after = action === 'delete' || isBulkDelete ? null : result;

      let changedFields: Record<string, { before: any; after: any }>;

      if (isBulkCreate) {
        const data = params.args?.data;
        const entityId = Array.isArray(data)
          ? (data[0]?.searchId ?? 0)
          : (data?.searchId ?? 0);
        changedFields = {
          bulkCreate: {
            before: null,
            after: {
              count: result?.count ?? (Array.isArray(data) ? data.length : 0),
            },
          },
        };
        await this.runWithoutAudit(() =>
          prisma.auditLog.create({
            data: {
              entityType: model,
              entityId,
              userId: ctx?.userId ?? undefined,
              action: AuditAction.CREATE,
              changedFields,
              before: undefined,
              after: undefined,
              requestId: ctx?.requestId,
              source: ctx?.source ?? AuditSource.system,
            },
          }),
        );
        return result;
      }

      if (isBulkDelete) {
        const deletedIds = Array.isArray(before)
          ? before.map((b: any) => b.id)
          : [];
        changedFields = {
          bulkDelete: {
            before: deletedIds,
            after: null,
          },
        };
        await this.runWithoutAudit(() =>
          prisma.auditLog.create({
            data: {
              entityType: model,
              entityId:
                Array.isArray(before) && before.length > 0
                  ? before[0].searchId
                  : 0,
              userId: ctx?.userId ?? undefined,
              action: AuditAction.DELETE,
              changedFields,
              before: before || undefined,
              after: undefined,
              requestId: ctx?.requestId,
              source: ctx?.source ?? AuditSource.system,
            },
          }),
        );
        return result;
      }

      changedFields = this.computeDiff(before, after);
      if (action === 'update' && Object.keys(changedFields).length === 0) {
        return result;
      }

      const userId =
        ctx?.userId ?? after?.userId ?? (before as any)?.userId ?? null;

      await this.runWithoutAudit(() =>
        prisma.auditLog.create({
          data: {
            entityType: model,
            entityId: after?.id || (before as any)?.id,
            userId: userId ?? undefined,
            action: this.mapAction(action),
            changedFields,
            before: before || undefined,
            after: after || undefined,
            requestId: ctx?.requestId,
            source: ctx?.source ?? AuditSource.system,
          },
        }),
      );

      return result;
    });
  }

  private mapAction(action: string): AuditAction {
    if (action === 'create') return AuditAction.CREATE;
    if (action === 'update') return AuditAction.UPDATE;
    if (action === 'delete') return AuditAction.DELETE;
    return AuditAction.UPDATE;
  }

  private async runWithoutAudit<T>(fn: () => Promise<T>): Promise<T> {
    return this.auditBypass.run(true, fn);
  }

  private normalizeValue(value: any): any {
    if (value instanceof Date) {
      return value.toISOString();
    }
    if (Array.isArray(value)) {
      return value.map((v) => this.normalizeValue(v));
    }
    if (value && typeof value === 'object') {
      const sortedKeys = Object.keys(value).sort();
      const normalized: Record<string, any> = {};
      for (const key of sortedKeys) {
        normalized[key] = this.normalizeValue(value[key]);
      }
      return normalized;
    }
    return value;
  }

  private computeDiff(
    before: Record<string, any> | null,
    after: Record<string, any> | null,
  ): Record<string, { before: any; after: any }> {
    const diff: Record<string, { before: any; after: any }> = {};

    const keys = new Set<string>([
      ...(before ? Object.keys(before) : []),
      ...(after ? Object.keys(after) : []),
    ]);

    for (const key of keys) {
      if (key === 'updatedAt' || key === 'createdAt') continue;
      const valBefore = this.normalizeValue(before ? before[key] : undefined);
      const valAfter = this.normalizeValue(after ? after[key] : undefined);

      if (JSON.stringify(valBefore) !== JSON.stringify(valAfter)) {
        diff[key] = { before: valBefore, after: valAfter };
      }
    }

    return diff;
  }


  async safeTransaction<T>(
    fn: (prisma: Prisma.TransactionClient) => Promise<T>,
    options: { timeout?: number; maxWait?: number } = {}
  ): Promise<T> {
    // 1. Récupération des valeurs depuis le ConfigService
    const defaultTimeout = parseInt(this.configService.get('PRISMA_TRANSACTION_TIMEOUT') || '30000', 10);
    const defaultMaxWait = parseInt(this.configService.get('PRISMA_TRANSACTION_MAX_WAIT') || '10000', 10);

    // 2. Appel de la méthode RÉELLE de Prisma : $transaction
    // On utilise (this as any) uniquement pour contourner l'erreur de typage TS sur le "$"
    return (this as any).$transaction(fn, {
      timeout: options.timeout || defaultTimeout,
      maxWait: options.maxWait || defaultMaxWait,
    });
  }


}
