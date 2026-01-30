import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AwsConfigService {
  constructor(private configService: ConfigService) {}

  get region(): string {
    return this.configService.get<string>('AWS_REGION', 'eu-west-1');
  }

  get accessKeyId(): string {
    return this.configService.getOrThrow<string>('AWS_ACCESS_KEY_ID');
  }

  get secretAccessKey(): string {
    return this.configService.getOrThrow<string>('AWS_SECRET_ACCESS_KEY');
  }

  get fromEmail(): string {
    return this.configService.getOrThrow<string>('AWS_SES_FROM_EMAIL');
  }

  get fromName(): string {
    return this.configService.getOrThrow<string>('AWS_SES_FROM_NAME');
  }

  get credentials() {
    return {
      accessKeyId: this.accessKeyId,
      secretAccessKey: this.secretAccessKey,
    };
  }
}
