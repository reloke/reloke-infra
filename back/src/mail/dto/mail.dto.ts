export class SendVerificationEmailDto {
  mail: string;
  fullName: string;
  otpCode: string;
}

export class SendWelcomeEmailDto {
  mail: string;
  fullName: string;
}

export class SendCustomEmailDto {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
}

export interface EmailOptions {
  to: string | string[];
  subject: string;
  template?: string;
  context?: Record<string, any>;
  html?: string;
  text?: string;
}
