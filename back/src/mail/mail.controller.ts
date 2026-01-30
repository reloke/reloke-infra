import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  SendVerificationEmailDto,
  SendWelcomeEmailDto,
  SendCustomEmailDto,
} from './dto/mail.dto';
import { MailService } from './mail.service';

@Controller('mail')
export class MailController {
  constructor(private readonly mailService: MailService) {}

  /**
   * Test de configuration SES
   * GET /emails/test-config
   */
  @Get('test-config')
  async testConfiguration() {
    try {
      const isValid = await this.mailService.verifyConfiguration();
      return {
        success: true,
        message: 'Configuration SES valide',
        configured: isValid,
      };
    } catch (error) {
      throw new HttpException(
        {
          success: false,
          message: 'Erreur de configuration SES',
          error: error.message,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('debug-config')
  debugConfig() {
    return {
      region: process.env.AWS_REGION,
      accessKeyId: process.env.AWS_ACCESS_KEY_ID?.substring(0, 8) + '...', // Masqué
      secretKeyDefined: !!process.env.AWS_SECRET_ACCESS_KEY,
      fromEmail: process.env.AWS_SES_FROM_EMAIL,
    };
  }

  /**
   * Envoie un email de vérification avec code OTP
   * POST /emails/send-verification
   */
  @Post('send-verification')
  async sendVerificationEmail(@Body() dto: SendVerificationEmailDto) {
    try {
      await this.mailService.sendVerificationEmail(
        dto.mail,
        dto.fullName,
        dto.otpCode,
      );

      return {
        success: true,
        message: 'Email de vérification envoyé avec succès',
        email: dto.mail,
      };
    } catch (error) {
      throw new HttpException(
        {
          success: false,
          message: "Erreur lors de l'envoi de l'email de vérification",
          error: error.message,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Envoie un email de bienvenue
   * POST /emails/send-welcome
   */
  @Post('send-welcome')
  async sendWelcomeEmail(@Body() dto: SendWelcomeEmailDto) {
    try {
      await this.mailService.sendWelcomeEmail(dto.mail, dto.fullName);

      return {
        success: true,
        message: 'Email de bienvenue envoyé avec succès',
        email: dto.mail,
      };
    } catch (error) {
      throw new HttpException(
        {
          success: false,
          message: "Erreur lors de l'envoi de l'email de bienvenue",
          error: error.message,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Envoie un email personnalisé
   * POST /emails/send-custom
   */
  @Post('send-custom')
  async sendCustomEmail(@Body() dto: SendCustomEmailDto) {
    try {
      await this.mailService.sendEmail({
        to: dto.to,
        subject: dto.subject,
        html: dto.html,
        text: dto.text,
      });

      return {
        success: true,
        message: 'Email personnalisé envoyé avec succès',
        to: dto.to,
      };
    } catch (error) {
      throw new HttpException(
        {
          success: false,
          message: "Erreur lors de l'envoi de l'email personnalisé",
          error: error.message,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Preview an email template (development only)
   * GET /mail/preview?template=matches-found
   *
   * Available templates:
   * - matches-found: New matches notification
   * - refund-confirmation: Refund confirmation
   * - verification-email: OTP verification
   * - welcome-email: Welcome email
   * - reset-password: Password reset
   * - password-updated: Password changed confirmation
   * - deletion-scheduled: Account deletion scheduled
   * - account-restored: Account restored
   */
  @Get('preview')
  async previewTemplate(
    @Query('template') template: string,
    @Res() res: Response,
  ) {
    if (!template) {
      return res.status(400).json({
        success: false,
        message: 'Template parameter is required',
        availableTemplates: [
          'matches-found',
          'refund-confirmation',
          'verification-email',
          'welcome-email',
          'reset-password',
          'password-updated',
          'deletion-scheduled',
          'account-restored',
          'change-email-request',
          'verify-new-email',
          'influencer-welcome',
          'influencer-report',
        ],
      });
    }

    try {
      const html = await this.mailService.previewTemplate(template);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(html);
    } catch (error) {
      throw new HttpException(
        {
          success: false,
          message: `Failed to preview template: ${template}`,
          error: error.message,
        },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  /**
   * List all available email templates
   * GET /mail/templates
   */
  @Get('templates')
  listTemplates() {
    return {
      success: true,
      templates: [
        { name: 'matches-found', description: 'New matches notification' },
        { name: 'refund-confirmation', description: 'Refund confirmation' },
        { name: 'verification-email', description: 'OTP verification' },
        { name: 'welcome-email', description: 'Welcome email' },
        { name: 'reset-password', description: 'Password reset' },
        {
          name: 'password-updated',
          description: 'Password changed confirmation',
        },
        {
          name: 'deletion-scheduled',
          description: 'Account deletion scheduled',
        },
        { name: 'account-restored', description: 'Account restored' },
        { name: 'change-email-request', description: 'Email change request' },
        { name: 'verify-new-email', description: 'Verify new email address' },
        { name: 'influencer-welcome', description: 'Influencer welcome' },
        {
          name: 'influencer-report',
          description: 'Influencer performance report',
        },
      ],
      usage: 'GET /mail/preview?template=<template-name>',
    };
  }
}
