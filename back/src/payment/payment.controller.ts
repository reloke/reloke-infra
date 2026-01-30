import { Controller, Post, Body, UseGuards, Request } from '@nestjs/common';
import { PaymentService } from './payment.service';
import { CreateOrderDto } from './dto/payment.dto';
import { AuthGuard } from '@nestjs/passport';

@Controller('payments')
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  @Post('create-order')
  @UseGuards(AuthGuard('jwt'))
  createOrder(@Request() req, @Body() createOrderDto: CreateOrderDto) {
    return this.paymentService.createOrder(req.user.userId, createOrderDto);
  }

  @Post('webhook')
  handleWebhook(@Body() event: any) {
    return this.paymentService.handleWebhook(event);
  }
}
