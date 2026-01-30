import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { MAIL_QUEUE_NAME } from './mail-queue.module';
import { MailService } from './mail.service';
import { RedisMailService } from './redis-mail.service';
import { EmailOptions } from './dto/mail.dto';

interface MailJobData {
  options: EmailOptions;
  mailUid: string;
}

@Processor(MAIL_QUEUE_NAME, {
  concurrency: 50,
  limiter: {
    max: Number(process.env.SES_MAX_PER_SECOND || 14),
    duration: 1000,
  },
})
export class MailProcessor extends WorkerHost {
  private readonly logger = new Logger(MailProcessor.name);

  constructor(
    private readonly mailService: MailService,
    private readonly redisMailService: RedisMailService,
  ) {
    super();
  }

  async process(job: Job<MailJobData>): Promise<void> {
    const { options, mailUid } = job.data;

    const quota = await this.redisMailService.reserveDailyQuotaOrNull();
    if (!quota.ok) {
      const jitter = Math.floor(Math.random() * 2000);
      const delayMs = quota.retryDelayMs + jitter;
      this.logger.warn(
        `[MailProcessor] Daily quota reached, rescheduling mailUid=${mailUid} delay=${delayMs}ms`,
      );
      await job.moveToDelayed(Date.now() + delayMs);
      return;
    }

    try {
      await (this.mailService as any).sendEmailNow(options);
      this.logger.log(
        `[MailProcessor] Email sent mailUid=${mailUid} to=${JSON.stringify(options.to)} subject="${options.subject}"`,
      );
    } catch (error) {
      await this.redisMailService.releaseDailyQuota();
      this.logger.error(
        `[MailProcessor] Email failed mailUid=${mailUid} error=${(error as Error)?.message || error}`,
      );
      throw error;
    }
  }
}
