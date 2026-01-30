import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Logger,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { AUTH_CONSTANTS } from './auth.constants';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import {
  RegisterDto,
  LoginDto,
  VerifyEmailDto,
  CompleteProfileDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  InitiateRegisterDto,
} from './dto/auth.dto';
import { RedisService } from '../redis/redis.service';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { MailService } from '../mail/mail.service';
import { STATUS_CODES } from 'http';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';

// Basic OTP Types
const OTP_TYPE = {
  REGISTER: 'register',
  FORGOT_PASSWORD: 'forgot_password',
  EMAIL_CHANGE_OLD: 'email_change_old',
  EMAIL_CHANGE_NEW: 'email_change_new',
  ADMIN_2FA: 'admin_2fa',
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private googleClient = new OAuth2Client();

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private mailService: MailService,
    private redisService: RedisService,
    private config: ConfigService,
  ) { }

  // Step 1: Initiate Register (Email) -> Send Code
  async initiateRegister(dto: InitiateRegisterDto, ip: string) {
    const { email } = dto;
    const safeIp = ip.replace(/:/g, '_');

    //Rate limit IP
    await this.checkIpRateLimit(safeIp);

    //Vérification DB silencieuse
    const existingUser = await this.prisma.user.findUnique({
      where: { mail: email },
    });

    //Toujours gérer la session Redis
    const redisKey = `${AUTH_CONSTANTS.REGISTER_SESSION.KEY}:${email}`;

    const session = await this.redisService.hgetall(redisKey);

    if (session && Object.keys(session).length > 0) {
      const attempts = Number(session.attempts) + 1;

      if (attempts > AUTH_CONSTANTS.REGISTER_SESSION.MAX_ATTEMPTS) {
        this.logger.warn(
          `[Auth] Register attempts exceeded for ${this.maskEmail(email)}`,
        );
        this.throwRateLimitException(
          'Trop de tentatives, réessayez plus tard.',
          AUTH_CONSTANTS.REGISTER_SESSION.TTL_SECONDS,
        );
      }

      await this.redisService.hset(redisKey, { attempts: attempts.toString() });
    } else {
      await this.redisService.hset(redisKey, {
        email: email,
        attempts: '1',
        createdAt: new Date().toISOString(),
      });
      await this.redisService.setExpire(
        redisKey,
        AUTH_CONSTANTS.REGISTER_SESSION.TTL_SECONDS,
      );
    }

    // Génération et stockage du code
    const verificationCode = this.generateOtp();
    const codeHash = this.hashCode(verificationCode);

    await this.redisService.hset(redisKey, {
      codeHash: codeHash,
    });

    // Envoi email (silencieux côté UI)
    if (!existingUser) {
      await this.mailService.sendVerificationEmail(
        email,
        'Future User',
        verificationCode,
      );
    } else {
      //TODO: verify number of attempts to send warning mail for data leak for user to change mail/mdp
      // await this.mailService.sendExistingAccountEmail(email);
    }

    return {
      message:
        'If the email provided is valid, a verification code has been sent.',
      status: STATUS_CODES.OK,
    };
  }

  generateOtp() {
    return Math.floor(100000 + Math.random() * 900000).toString(); // 6 digits
  }

  hashCode(str: string): string {
    return crypto.createHash('sha256').update(str).digest('hex');
  }

  async checkIpRateLimit(safeIp: string) {
    const ipKey = `${AUTH_CONSTANTS.RATE_LIMIT.IP.KEY}:${safeIp}`;
    const ipCount = await this.redisService.incr(ipKey);
    if (ipCount === 1)
      await this.redisService.setExpire(
        ipKey,
        AUTH_CONSTANTS.RATE_LIMIT.IP.TTL_SECONDS,
      );
    if (ipCount > AUTH_CONSTANTS.RATE_LIMIT.IP.MAX_ATTEMPTS) {
      this.logger.warn(
        `[Auth] Rate Limit IP BLOCKED: ${safeIp} exceeded global limits.`,
      );
      this.throwRateLimitException(
        'Trop de tentatives, réessayez plus tard.',
        AUTH_CONSTANTS.RATE_LIMIT.IP.TTL_SECONDS,
      );
    }
  }

  // --- Login Rate Limiting Helpers ---

  async checkLoginRateLimit(safeIp: string, email: string) {
    const mailKey = `${AUTH_CONSTANTS.RATE_LIMIT.EMAIL_LOGIN.KEY}:${email}`;
    const mailAttempts = await this.redisService.incr(mailKey);

    if (mailAttempts === 1)
      await this.redisService.setExpire(
        mailKey,
        AUTH_CONSTANTS.RATE_LIMIT.EMAIL_LOGIN.TTL_SECONDS,
      );

    if (
      mailAttempts &&
      Number(mailAttempts) >= AUTH_CONSTANTS.RATE_LIMIT.EMAIL_LOGIN.MAX_ATTEMPTS
    ) {
      this.logger.warn(`[Auth] Login Blocked for Email: ${email}`);
      this.throwRateLimitException(
        'Trop de tentatives de connexion échouées. Veuillez réessayez dans 5 minutes.',
        AUTH_CONSTANTS.RATE_LIMIT.EMAIL_LOGIN.TTL_SECONDS,
      );
    }

    const ipKey = `${AUTH_CONSTANTS.RATE_LIMIT.IP_LOGIN.KEY}:${safeIp}`;
    const ipAttempts = await this.redisService.incr(ipKey);

    if (ipAttempts === 1)
      await this.redisService.setExpire(
        ipKey,
        AUTH_CONSTANTS.RATE_LIMIT.IP_LOGIN.TTL_SECONDS,
      );

    if (
      ipAttempts &&
      Number(ipAttempts) >= AUTH_CONSTANTS.RATE_LIMIT.IP_LOGIN.MAX_ATTEMPTS
    ) {
      this.logger.warn(`[Auth] Login Blocked for IP: ${safeIp}`);
      this.throwRateLimitException(
        'Trop de tentatives de connexion échouées. Veuillez réessayez dans 1h.',
        AUTH_CONSTANTS.RATE_LIMIT.IP_LOGIN.TTL_SECONDS,
      );
    }
  }

  async resetLoginRateLimit(safeIp: string, email: string) {
    const ipKey = `${AUTH_CONSTANTS.RATE_LIMIT.IP_LOGIN.KEY}:${safeIp}`;
    const emailKey = `${AUTH_CONSTANTS.RATE_LIMIT.EMAIL_LOGIN.KEY}:${email}`;
    await this.redisService.del(emailKey);
    await this.redisService.del(ipKey);
  }

  private throwRateLimitException(message: string, retryAfter: number): void {
    throw new HttpException(
      {
        message: message,
        retryAfter: retryAfter,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  // -----------------------------------

  private maskEmail(email: string): string {
    const [user, domain] = email.split('@');
    return `${user.slice(0, 3)}***@${domain}`;
  }

  // Step 2: Verify Code
  async verifyCode(verifyEmailDto: VerifyEmailDto) {
    const { email, code } = verifyEmailDto;
    const redisKey = `${AUTH_CONSTANTS.REGISTER_SESSION.KEY}:${email}`;

    const session = await this.redisService.hgetall(redisKey);

    if (!session || Object.keys(session).length === 0) {
      // Expired or invalid
      throw new BadRequestException('Verification code expired or invalid.');
    }

    if (
      Number(session.attempts) >= AUTH_CONSTANTS.REGISTER_SESSION.MAX_ATTEMPTS
    ) {
      await this.redisService.del(redisKey);
      this.throwRateLimitException(
        "Trop de tentatives. Veuillez réessayer l'inscription plus tard.",
        AUTH_CONSTANTS.REGISTER_SESSION.TTL_SECONDS,
      );
    }

    const inputHash = this.hashCode(code);

    if (inputHash !== session.codeHash) {
      // Increment attempts
      await this.redisService.hincrby(redisKey, 'attempts', 1);
      throw new BadRequestException('Invalid verification code');
    }

    // Code is valid.
    // Return Registration Token (JWT)
    // Payload: email, verified=true
    const payload = { email, verified: true };
    const registrationToken = this.jwtService.sign(payload, { expiresIn: 900 });

    return { registrationToken };
  }

  // Step 3: Finalize Register
  async register(registerDto: RegisterDto, ip: string) {
    const {
      registrationToken,
      password,
      firstName,
      lastName,
      cguAccepted,
      cguVersion,
    } = registerDto;

    try {
      const payload = this.jwtService.verify(registrationToken);
      if (!payload.email || !payload.verified) {
        throw new UnauthorizedException('Invalid registration token');
      }

      if (!cguAccepted) {
        throw new BadRequestException(
          "Vous devez accepter les conditions générales d'utilisation (CGU).",
        );
      }

      const email = payload.email;

      // Double check existence (race condition)
      const existingUser = await this.prisma.user.findUnique({
        where: { mail: email },
      });

      if (existingUser) {
        throw new BadRequestException('User already exists');
      }

      const hashedPassword = await bcrypt.hash(password, 10);

      // [NEW] Handle influencer referral from 'from' hash
      let influencerId: number | null = null;
      if (registerDto.from) {
        const influencer = await this.prisma.influencer.findUnique({
          where: { influencerHash: registerDto.from },
        });
        if (influencer) {
          influencerId = influencer.id;
        } else {
          this.logger.warn(
            `[Register] Influencer hash not found: ${registerDto.from}`,
          );
        }
      }

      // Create user ACTIVE
      const user = await this.prisma.user.create({
        data: {
          mail: email,
          password: hashedPassword,
          firstName,
          lastName,
          status: 'ACTIVE',
          role: 'USER',
          isEmailVerified: true,
          dateLastConnection: new Date(),
          influencerId, // Link to influencer if found
          cguAccepted: true,
          cguAcceptedAt: new Date(),
          cguVersion: cguVersion || '1.0',
        },
      });

      // Send Welcome Email
      await this.mailService.sendWelcomeEmail(email, firstName);

      // Clean Redis (optional)
      const redisKey = `${AUTH_CONSTANTS.REGISTER_SESSION.KEY}:${email}`;
      await this.redisService.del(redisKey);

      // Auto-login
      // Generate standard access token
      await this.createConnectionLog(user, ip);
      return this.generateTokenAndReturnUser(user);
    } catch (e) {
      if (e instanceof UnauthorizedException) throw e;
      console.error('Registration error:', e);
      throw new BadRequestException('Registration failed or token expired.');
    }
  }

  async login(loginDto: LoginDto, ip: string = 'unknown') {
    const { email, password } = loginDto;
    const safeIp = ip.replace(/:/g, '_'); // Sanitize IP for Redis key

    // 1. Check Rate Limit (IP based)
    await this.checkLoginRateLimit(safeIp, email);

    const user = await this.prisma.user.findUnique({
      where: { mail: email },
      include: {
        usedPromoCode: true,
        influencer: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Handle case where user signed up via Google and has no password
    if (user.googleId && (!user.password || user.password === '')) {
      throw new HttpException('AUTH_PROVIDER_GOOGLE', HttpStatus.BAD_REQUEST);
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Check if Anonymized
    if (user.deletedAt) {
      throw new ForbiddenException('ACCOUNT_DELETED');
    }

    if (!user.isEmailVerified) {
      throw new UnauthorizedException('Email not verified');
    }

    // [NEW] If user is ADMIN, force 2FA
    if (user.role === 'ADMIN') {
      const redisKey = `${AUTH_CONSTANTS.ADMIN_2FA_SESSION.KEY}:${email}`;
      const otpCode = this.generateOtp();
      const codeHash = this.hashCode(otpCode);

      await this.redisService.hset(redisKey, {
        codeHash: codeHash,
        attempts: '0',
      });
      await this.redisService.setExpire(
        redisKey,
        AUTH_CONSTANTS.ADMIN_2FA_SESSION.TTL_SECONDS,
      );

      // Send Admin 2FA Email
      await this.mailService.sendVerificationEmail(
        email,
        user.firstName,
        otpCode,
      );

      return { requires2FA: true, email: user.mail };
    }

    // Reset failure count on success
    await this.resetLoginRateLimit(safeIp, email);

    await this.createConnectionLog(user, ip);
    const result = await this.generateTokenAndReturnUser(user);

    // Add pending deletion flag for frontend
    if (user.deletionScheduledAt) {
      (result as any).isPendingDeletion = true;
      (result as any).deletionDate = user.deletionScheduledAt;
    }

    return result;
  }

  async verifyAdmin2FA(verifyDto: VerifyEmailDto, ip: string = 'unknown') {
    const { email, code } = verifyDto;
    const redisKey = `${AUTH_CONSTANTS.ADMIN_2FA_SESSION.KEY}:${email}`;

    const session = await this.redisService.hgetall(redisKey);
    if (!session || Object.keys(session).length === 0) {
      throw new BadRequestException('Code expiré ou invalide.');
    }

    const attempts = Number(session.attempts) + 1;
    if (attempts > AUTH_CONSTANTS.ADMIN_2FA_SESSION.MAX_ATTEMPTS) {
      await this.redisService.del(redisKey);
      throw new BadRequestException(
        'Trop de tentatives. Veuillez vous reconnecter.',
      );
    }

    await this.redisService.hset(redisKey, { attempts: attempts.toString() });

    const inputHash = this.hashCode(code);
    if (inputHash !== session.codeHash) {
      throw new BadRequestException('Code de vérification invalide.');
    }

    // Success - find user and login
    const user = await this.prisma.user.findUnique({
      where: { mail: email },
      include: { usedPromoCode: true, influencer: true },
    });

    if (!user || user.role !== 'ADMIN') {
      throw new UnauthorizedException();
    }

    // Cleanup
    await this.redisService.del(redisKey);

    const safeIp = ip.replace(/:/g, '_');
    await this.resetLoginRateLimit(safeIp, email);
    await this.createConnectionLog(user, ip);
    return this.generateTokenAndReturnUser(user);
  }

  private async createConnectionLog(user, ip: string) {
    // Create Connection Log
    await this.prisma.connectionLog.create({
      data: {
        userId: user.id,
        ip: ip,
        loginDate: new Date(),
      },
    });

    // Update Last Connection
    await this.prisma.user.update({
      where: { id: user.id },
      data: { dateLastConnection: new Date() },
    });
  }

  async refreshToken(refreshToken: string, ip: string) {
    try {
      const payload = this.jwtService.verify(refreshToken, {
        secret: process.env.REFRESH_TOKEN_SECRET || 'superRefreshSecret',
      });

      // Check if it's a refresh token type
      if (payload.type !== 'refresh') {
        throw new UnauthorizedException('Invalid token type');
      }

      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        include: {
          usedPromoCode: true,
          influencer: true,
        },
      });

      if (!user) {
        throw new UnauthorizedException('User not found');
      }

      // Revocation check could go here (e.g. check DB if token is blacklisted or user token version changed)

      // Sliding Session: Create NEW connection log or just update last connection?
      // Requirement says "Reset 3-hour countdown", effectively handled by issuing new token.
      await this.createConnectionLog(user, ip);

      return this.generateTokenAndReturnUser(user);
    } catch (e) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
  }

  private async generateTokenAndReturnUser(user) {
    const jwtSecret = this.config.get('JWT_SECRET') || 'superSecret';
    const payload = {
      email: user.mail,
      sub: user.id,
      role: user.role,
      version: user.tokenVersion || 0, // Include token version
    };

    // Access Token: 15 minutes
    const accessToken = this.jwtService.sign(payload, {
      secret: jwtSecret,
      expiresIn: AUTH_CONSTANTS.JWT.ACCESS_TOKEN_EXPIRE,
    });

    // Refresh Token: 3 Hours
    // We use a different secret ideally, but for simplicity/setup I'll use REFRESH_TOKEN_SECRET if available or verify options
    // Actually, JwtModule registers ONE secret by default.
    // To use a different secret for Refresh Tokens, we should pass 'secret' to sign().
    const refreshSecret =
      this.config.get('REFRESH_TOKEN_SECRET') || 'superRefreshSecret';
    const refreshPayload = {
      sub: user.id,
      type: 'refresh',
      version: user.tokenVersion || 0, // Include version in refresh token too
    };

    const refreshToken = this.jwtService.sign(refreshPayload, {
      secret: refreshSecret,
      expiresIn: AUTH_CONSTANTS.JWT.REFRESH_TOKEN_EXPIRE,
    });

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      user: {
        id: user.id,
        mail: user.mail,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        isLocked: user.isLocked,
        isKycVerified: user.isKycVerified,
        accountValidatedAt: user.accountValidatedAt,
        createdAt: user.createdAt,
        dateLastConnection: user.dateLastConnection,
        lastPasswordUpdate: user.lastPasswordUpdate,
        kycStatus: user.kycStatus,
        usedPromoCode: user.usedPromoCode,
        influencer: user.influencer,
        hasPassword: !!user.password && user.password !== '',
        provider: user.googleId ? 'google' : 'local',
        dossierFacileUrl: user.dossierFacileUrl,
        isDossierValid: user.isDossierValid,
        lastDossierCheckAt: user.lastDossierCheckAt,
        isBanned: user.isBanned,
        bannedAt: user.bannedAt,
        banReason: user.banReason,
        pushEnabled: user.pushEnabled,
      },
    };
  }

  // Removed checkEmailExists

  async forgotPassword(forgotPasswordDto: ForgotPasswordDto) {
    const { email } = forgotPasswordDto;

    // Rate Limit (Email based)
    const limitKey = `${AUTH_CONSTANTS.RATE_LIMIT.FORGOT_PASSWORD.KEY}:${email}`;
    const attempts = await this.redisService.incr(limitKey);
    if (attempts === 1)
      await this.redisService.setExpire(
        limitKey,
        AUTH_CONSTANTS.RATE_LIMIT.FORGOT_PASSWORD.TTL_SECONDS,
      );

    if (attempts > AUTH_CONSTANTS.RATE_LIMIT.FORGOT_PASSWORD.MAX_ATTEMPTS) {
      this.throwRateLimitException(
        'Trop de demandes. Veuillez réessayer plus tard.',
        AUTH_CONSTANTS.RATE_LIMIT.FORGOT_PASSWORD.TTL_SECONDS,
      );
    }

    const user = await this.prisma.user.findUnique({ where: { mail: email } });

    if (!user) {
      // Security: Don't reveal if user exists.
      return {
        message:
          'Si votre email est enregistré, vous recevrez un lien de réinitialisation.',
      };
    }

    // Generate token
    const resetToken = crypto.randomBytes(32).toString('hex');

    // Use SHA256 for deterministic storage/lookup
    const hash = crypto.createHash('sha256').update(resetToken).digest('hex');

    // Expiry: 1 hour
    const resetExpires = new Date(Date.now() + 3600000);

    await this.prisma.user.update({
      where: { mail: email },
      data: {
        resetPasswordToken: hash,
        resetPasswordExpires: resetExpires,
      },
    });

    // Send Email with PLAIN token
    await this.mailService.sendPasswordResetEmail(
      user.mail,
      user.firstName,
      resetToken,
    );

    return {
      message:
        'Si votre email est enregistré, vous recevrez un lien de réinitialisation.',
    };
  }

  async resetPassword(resetPasswordDto: ResetPasswordDto) {
    // Rate Limit (IP based for brute force protection)
    // omitted for simplicity

    const { token, newPassword } = resetPasswordDto;

    // Hash the incoming token to match DB storage
    const hash = crypto.createHash('sha256').update(token).digest('hex');

    const user = await this.prisma.user.findFirst({
      where: {
        resetPasswordToken: hash,
        resetPasswordExpires: { gt: new Date() },
      },
    });

    if (!user) {
      throw new BadRequestException(
        'Jeton de réinitialisation invalide ou expiré',
      );
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
        resetPasswordToken: null,
        resetPasswordExpires: null,
      },
    });

    await this.mailService.sendPasswordUpdatedEmail(user.mail, user.firstName);

    return { message: 'Votre mot de passe a été réinitialisé avec succès' };
  }

  // --- Email Change Logic ---

  async initiateChangeEmail(userId: number): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    // PROTECTION: Google users must create a password before changing email
    const isGoogleUser = !!user.googleId;
    const hasLocalPassword = !!user.password && user.password !== '';

    if (isGoogleUser && !hasLocalPassword) {
      throw new ForbiddenException(
        'Veuillez créer un mot de passe avant de changer votre adresse e-mail',
      );
    }

    const otp = this.generateOtp();

    // REVISED FLOW:
    // 1. Initiate: Generate OTP -> Save hash to User.resetPasswordToken. Send to Old Mail.
    const hashedOtp = await bcrypt.hash(otp, 10);
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        resetPasswordToken: hashedOtp, // Reusing field
        resetPasswordExpires: new Date(Date.now() + 10 * 60 * 1000), // 10m
      },
    });

    await this.mailService.sendChangeEmailRequest(
      user.mail,
      user.firstName,
      otp,
    );
  }

  async verifyOldEmail(
    userId: number,
    code: string,
  ): Promise<{ changeEmailToken: string }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.resetPasswordToken || !user.resetPasswordExpires) {
      throw new BadRequestException('Invalid or expired request');
    }

    if (user.resetPasswordExpires < new Date()) {
      throw new BadRequestException('Code expired');
    }

    const isValid = await bcrypt.compare(code, user.resetPasswordToken);
    if (!isValid) {
      throw new BadRequestException('Invalid code');
    }

    // Clear used token
    await this.prisma.user.update({
      where: { id: userId },
      data: { resetPasswordToken: null, resetPasswordExpires: null },
    });

    // Issue simple short-lived JWT for the next steps
    const payload = { sub: user.id, scope: 'email_change' };
    const token = this.jwtService.sign(payload, { expiresIn: 1200 }); // 20 mins to finish flow
    return { changeEmailToken: token };
  }

  async requestNewEmail(
    userId: number,
    newEmail: string,
    changeEmailToken: string,
  ): Promise<void> {
    // Validate Token Scope
    try {
      const payload = this.jwtService.verify(changeEmailToken);
      if (payload.sub !== userId || payload.scope !== 'email_change') {
        throw new UnauthorizedException('Invalid token scope');
      }
    } catch (e) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    // Check if email taken
    const existing = await this.prisma.user.findUnique({
      where: { mail: newEmail },
    });
    if (existing) throw new BadRequestException('Email already in use');

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const otp = this.generateOtp();

    // Store: JSON.stringify({ hash: await bcrypt.hash(otp), email: newEmail })
    const hash = await bcrypt.hash(otp, 10);
    const dataStr = JSON.stringify({ hash, email: newEmail });

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        resetPasswordToken: dataStr,
        resetPasswordExpires: new Date(Date.now() + 10 * 60 * 1000),
      },
    });

    await this.mailService.sendNewEmailVerification(
      newEmail,
      user.firstName,
      otp,
    );
  }

  async verifyNewEmail(userId: number, code: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.resetPasswordToken || !user.resetPasswordExpires)
      throw new BadRequestException('Request invalid');

    let data;
    try {
      data = JSON.parse(user.resetPasswordToken);
    } catch (e) {
      throw new BadRequestException('Invalid token format');
    }

    if (!data.hash || !data.email)
      throw new BadRequestException('Invalid token data');

    const isValid = await bcrypt.compare(code, data.hash);
    if (!isValid) throw new BadRequestException('Invalid code');

    if (user.resetPasswordExpires < new Date())
      throw new BadRequestException('Code expired');

    const oldEmail = user.mail;
    const newEmail = data.email;

    // Update Email and Clear
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        mail: newEmail,
        isEmailVerified: true,
        resetPasswordToken: null,
        resetPasswordExpires: null,
      },
    });

    // Send confirmation email (ONLY to the new address)
    try {
      await this.mailService.sendEmailUpdatedEmail(
        newEmail,
        user.firstName,
        newEmail,
      );
    } catch (e) {
      this.logger.error(
        `Failed to send email update confirmation (4-step): ${e.message}`,
      );
    }
  }

  async changePassword(
    userId: number,
    changePasswordDto: { oldPassword?: string; newPassword: string },
  ) {
    const { oldPassword, newPassword } = changePasswordDto;
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (!user) throw new NotFoundException('User not found');

    const hasCurrentPassword = user.password && user.password !== '';

    if (hasCurrentPassword) {
      if (!oldPassword) {
        throw new BadRequestException("L'ancien mot de passe est obligatoire.");
      }
      const isPasswordValid = await bcrypt.compare(oldPassword, user.password);
      if (!isPasswordValid)
        throw new BadRequestException('Ancien mot de passe incorrect');

      const isSameAsCurrent = await bcrypt.compare(newPassword, user.password);
      if (isSameAsCurrent) {
        throw new BadRequestException(
          "Le nouveau mot de passe doit être différent de l'ancien.",
        );
      }
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await this.prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword },
    });

    await this.mailService.sendPasswordUpdatedEmail(user.mail, user.firstName);

    return { message: 'Mot de passe modifié avec succès' };
  }

  // --- Direct Email Change Logic ---

  async requestEmailChangeDirect(userId: number, newEmail: string) {
    // 0. Rate Limit (User based)
    const rateLimitKey = `${AUTH_CONSTANTS.RATE_LIMIT.EMAIL_CHANGE.KEY}:${userId}`;
    const currentAttempts = await this.redisService.incr(rateLimitKey);

    if (currentAttempts === 1) {
      await this.redisService.setExpire(
        rateLimitKey,
        AUTH_CONSTANTS.RATE_LIMIT.EMAIL_CHANGE.TTL_SECONDS,
      );
    }

    if (currentAttempts > AUTH_CONSTANTS.RATE_LIMIT.EMAIL_CHANGE.MAX_ATTEMPTS) {
      this.throwRateLimitException(
        "Limite de modifications d'email atteinte (3/jour). Veuillez réessayer demain.",
        AUTH_CONSTANTS.RATE_LIMIT.EMAIL_CHANGE.TTL_SECONDS,
      );
    }

    // 1. Check if email is already taken
    const existing = await this.prisma.user.findUnique({
      where: { mail: newEmail },
    });
    if (existing) throw new BadRequestException('Cet email est déjà utilisé.');

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    // PROTECTION: Google users must create a password before changing email
    const isGoogleUser = !!user.googleId;
    const hasLocalPassword = !!user.password && user.password !== '';

    if (isGoogleUser && !hasLocalPassword) {
      throw new ForbiddenException(
        'Veuillez créer un mot de passe avant de changer votre adresse e-mail',
      );
    }

    // 2. Generate OTP
    const otp = this.generateOtp();

    // 3. Store Hash + Email in resetPasswordToken (Temporary storage reusable field)
    // Store: JSON.stringify({ hash: await bcrypt.hash(otp), email: newEmail })
    const hash = await bcrypt.hash(otp, 10);
    const dataStr = JSON.stringify({ hash, email: newEmail });

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        resetPasswordToken: dataStr,
        resetPasswordExpires: new Date(Date.now() + 15 * 60 * 1000), // 15 mins
      },
    });

    // 4. Send OTP to NEW Email indicating it's a verification code
    // We reuse sendNewEmailVerification or similar.
    await this.mailService.sendNewEmailVerification(
      newEmail,
      user.firstName,
      otp,
    );

    return { message: 'Code de vérification envoyé.' };
  }

  async verifyEmailChangeDirect(
    userId: number,
    code: string,
    newEmail: string,
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.resetPasswordToken || !user.resetPasswordExpires) {
      throw new BadRequestException('Aucune demande en cours ou expirée.');
    }

    // Check Expiry
    if (user.resetPasswordExpires < new Date()) {
      throw new BadRequestException('Code expiré.');
    }

    // Parse Data
    let data;
    try {
      data = JSON.parse(user.resetPasswordToken);
    } catch (e) {
      throw new BadRequestException('Données invalides.');
    }

    if (data.email !== newEmail) {
      throw new BadRequestException("L'email ne correspond pas à la demande.");
    }

    // Verify Code
    const isValid = await bcrypt.compare(code, data.hash);
    if (!isValid) throw new BadRequestException('Code invalide.');

    const oldEmail = user.mail;

    // Update User
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        mail: newEmail,
        isEmailVerified: true, // Assuming new email is verified by this process
        resetPasswordToken: null,
        resetPasswordExpires: null,
      },
    });

    // 5. Send confirmation email (ONLY to the new address to avoid duplicates if user has access to both)
    try {
      await this.mailService.sendEmailUpdatedEmail(
        newEmail,
        user.firstName,
        newEmail,
      );
    } catch (e) {
      this.logger.error(
        `Failed to send email update confirmation: ${e.message}`,
      );
    }

    return { message: 'Email mis à jour avec succès.' };
  }

  // ============================================================
  // Google OAuth Authentication
  // ============================================================

  /**
   * Handle Google OAuth login/registration
   *
   * Logic:
   * 1. If user with email exists -> Link Google account and login
   * 2. If user with googleId exists -> Login directly
   * 3. Otherwise -> Create new user with Google data
   */
  async googleLogin(
    googleUser: {
      googleId: string;
      email: string;
      firstName: string;
      lastName: string;
      picture: string | null;
    },
    ip: string = 'unknown',
  ) {
    const { googleId, email, firstName, lastName, picture } = googleUser;

    this.logger.log(`Google OAuth: Processing login for ${email}`);

    // First, try to find user by googleId (already linked)
    let user = await this.prisma.user.findFirst({
      where: { googleId },
      include: {
        usedPromoCode: true,
        influencer: true,
      },
    });

    if (user) {
      this.logger.log(
        `Google OAuth: Found existing user by googleId: ${user.id}`,
      );
      await this.createConnectionLog(user, ip);
      return this.generateTokenAndReturnUser(user);
    }

    // Second, try to find user by email (account linking)
    user = await this.prisma.user.findUnique({
      where: { mail: email },
      include: {
        usedPromoCode: true,
        influencer: true,
      },
    });

    if (user) {
      this.logger.log(
        `Google OAuth: Linking Google account to existing user: ${user.id}`,
      );

      // Update existing user with Google data
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: {
          googleId,
          // Only update profile fields if they are empty
          firstName: user.firstName || firstName,
          lastName: user.lastName || lastName,
          profilePicture: user.profilePicture || picture,
          isEmailVerified: true, // Google-verified email
        },
        include: {
          usedPromoCode: true,
          influencer: true,
        },
      });

      await this.createConnectionLog(user, ip);
      return this.generateTokenAndReturnUser(user);
    }

    // Third, create new user with Google data? NO.
    // Request: "If email does NOT exist: Do NOT create account yet. Redirect to /auth/accept-cgu".
    this.logger.log(
      `Google OAuth: New user detected for ${email}. Requiring CGU acceptance.`,
    );

    // Generate a temporary signed token containing the profile
    // We will store this in the frontend redirect URL query param
    const registrationPayload = {
      googleId,
      email,
      firstName,
      lastName,
      picture,
      type: 'google_cgu_pending',
    };

    const tempToken = this.jwtService.sign(registrationPayload, {
      secret: this.config.get('JWT_SECRET'),
      expiresIn: '15m',
    });

    // Return a special object that the controller can detect
    return {
      requiresCguAcceptance: true,
      tempToken,
      firstName,
      email,
    };
  }

  /**
   * Complete Google Registration after CGU acceptance
   */
  async completeGoogleRegistration(tempToken: string) {
    try {
      const payload = this.jwtService.verify(tempToken, {
        secret: this.config.get('JWT_SECRET'),
      });

      if (payload.type !== 'google_cgu_pending') {
        throw new UnauthorizedException('Invalid token type');
      }

      const { googleId, email, firstName, lastName, picture } = payload;

      // Double check existence
      const existing = await this.prisma.user.findUnique({
        where: { mail: email },
      });
      if (existing) throw new BadRequestException('User already exists');

      // Create User with CGU
      const cguVersion = process.env.CGU_VERSION || '1.0';

      const user = await this.prisma.user.create({
        data: {
          mail: email,
          firstName,
          lastName,
          googleId,
          profilePicture: picture,
          password: '',
          status: 'ACTIVE',
          isActif: true,
          isEmailVerified: true,
          role: 'USER',
          kycStatus: 'UNVERIFIED',
          cguAccepted: true,
          cguAcceptedAt: new Date(),
          cguVersion: cguVersion,
        },
        include: {
          usedPromoCode: true,
          influencer: true,
        },
      });

      await this.createConnectionLog(user, 'unknown'); // IP not passed here easily without breaking sig, assumed ok
      return this.generateTokenAndReturnUser(user);
    } catch (e) {
      this.logger.error(`Complete Google Registration failed: ${e.message}`);
      throw new UnauthorizedException('Session expired or invalid');
    }
  }

  async googleLoginOneTap(credential: string, ip: string = 'unknown') {
    const clientId = this.config.get<string>('GOOGLE_CLIENT_ID');

    try {
      const ticket = await this.googleClient.verifyIdToken({
        idToken: credential,
        audience: clientId,
      });
      const payload = ticket.getPayload();
      if (!payload) throw new UnauthorizedException('Invalid Google token');

      const googleUser = {
        googleId: payload.sub,
        email: payload.email!,
        firstName: payload.given_name || '',
        lastName: payload.family_name || '',
        picture: payload.picture || null,
      };

      return this.googleLogin(googleUser, ip);
    } catch (error) {
      this.logger.error(`Google One Tap verification failed: ${error.message}`);
      throw new UnauthorizedException('Authentication failed');
    }
  }
}
