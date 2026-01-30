import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Observable } from 'rxjs';
import { RequestContextService } from './request-context.service';
import { AuditSource } from '@prisma/client';

@Injectable()
export class RequestContextInterceptor implements NestInterceptor {
  constructor(private readonly requestContext: RequestContextService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const httpContext = context.switchToHttp();
    const req = httpContext.getRequest();
    const userId = req?.user?.userId as number | undefined;

    const requestId = randomUUID();

    return this.requestContext.runWith(
      {
        requestId,
        userId,
        source: AuditSource.http,
      },
      () => next.handle(),
    );
  }
}
