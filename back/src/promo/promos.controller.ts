import { Controller, Get, Param, Post, UseGuards, Req } from '@nestjs/common';
import { PromosService } from './promos.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('promos')
export class PromosController {
  constructor(private promosService: PromosService) {}

  @Get('check/:code')
  async checkPromo(@Param('code') code: string) {
    return this.promosService.validatePromoCode(code);
  }

  // Example of how it would be used (though usually applied during payment/registration)
  @Post('apply/:code')
  @UseGuards(JwtAuthGuard)
  async applyPromo(@Req() req, @Param('code') code: string) {
    return this.promosService.applyPromoCodeToUser(req.user.userId, code);
  }
}
