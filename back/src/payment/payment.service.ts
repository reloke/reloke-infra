import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOrderDto } from './dto/payment.dto';

@Injectable()
export class PaymentService {
  constructor(private prisma: PrismaService) {}

  async createOrder(userId: number, createOrderDto: CreateOrderDto) {
    if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET) {
      console.warn('PayPal credentials not found, using mock implementation');
      const mockOrderId = 'PAYPAL_ORDER_' + Math.floor(Math.random() * 1000000);
      return {
        orderId: mockOrderId,
        approvalUrl: `https://www.sandbox.paypal.com/checkoutnow?token=${mockOrderId}`,
      };
    }

    try {
      const accessToken = await this.getAccessToken();
      const response = await axios.post(
        'https://api-m.sandbox.paypal.com/v2/checkout/orders',
        {
          intent: 'CAPTURE',
          purchase_units: [
            {
              amount: {
                currency_code: 'EUR',
                value: createOrderDto.amount.toString(),
              },
              description: createOrderDto.packId,
            },
          ],
          application_context: {
            return_url: `${process.env.FRONTEND_URL || 'http://localhost:4200'}/payment/success`,
            cancel_url: `${process.env.FRONTEND_URL || 'http://localhost:4200'}/payment/cancel`,
          },
        },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        },
      );

      const approvalUrl = response.data.links.find(
        (link: any) => link.rel === 'approve',
      ).href;

      return {
        orderId: response.data.id,
        approvalUrl,
      };
    } catch (error) {
      console.error('PayPal Error:', error.response?.data || error.message);
      throw new Error('Failed to create PayPal order');
    }
  }

  private async getAccessToken() {
    const clientId = process.env.PAYPAL_CLIENT_ID;
    const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
    const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    const response = await axios.post(
      'https://api-m.sandbox.paypal.com/v1/oauth2/token',
      'grant_type=client_credentials',
      {
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      },
    );

    return response.data.access_token;
  }

  async handleWebhook(event: any) {
    // Handle 'PAYMENT.CAPTURE.COMPLETED'
    // Update User's match balance and Intent status
    console.log('Webhook received:', event);
    return { received: true };
  }
}
