import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class CaptchaService {
  private readonly logger = new Logger(CaptchaService.name);
  constructor(
    private httpService: HttpService,
    private configService: ConfigService,
    private jwtService: JwtService,
  ) {}

  generateVerificationToken(): string {
    return this.jwtService.sign({ verified: true });
  }

  async validateCaptchaToken(captchaToken: string): Promise<boolean> {
    const captchaSecretKey = this.configService.get(
      'RECAPTCHA_SECRET_ACCESS_KEY',
    );
    const captchaUrl = this.configService.get('RECAPTCHA_VERIFY_URL');
    const scoreThreshold = this.configService.get('RECAPTCHA_SCORE_THRESHOLD');

    const params = new URLSearchParams();
    params.append('secret', captchaSecretKey);
    params.append('response', captchaToken);

    try {
      const { data } = await firstValueFrom(
        this.httpService.post(captchaUrl, params),
      );

      if (!data.success || data.score < scoreThreshold) {
        this.logger.error(
          `Captcha failed or low score. Score: ${data.score}, Threshold: ${scoreThreshold}, Success: ${data.success}, Errors: ${JSON.stringify(data['error-codes'])}`,
        );
        return false;
      }

      console.log('Captcha is successful: ', data);
      return true;
    } catch (error) {
      console.log('Google API CAPTCHA error: ', error);
      return false;
    }
  }
}
