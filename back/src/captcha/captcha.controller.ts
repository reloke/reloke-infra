import {
  Controller,
  Post,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { CaptchaService } from './captcha.service';
import { CaptchaGuard } from './captcha.guard';

@Controller('captcha')
export class CaptchaController {
  constructor(private readonly captchaService: CaptchaService) {}

  @Post('verify')
  @UseGuards(CaptchaGuard)
  @HttpCode(HttpStatus.OK)
  verify() {
    // If we reach here, CaptchaGuard has already validated the token
    const verificationToken = this.captchaService.generateVerificationToken();
    return { verificationToken };
  }
}
