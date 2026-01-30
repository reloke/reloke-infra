import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback, Profile } from 'passport-google-oauth20';
import { ConfigService } from '@nestjs/config';

/**
 * Google OAuth2 Strategy for Passport.js
 *
 * Handles Google Sign-In authentication flow.
 * Extracts user profile data from Google and passes it to the auth service.
 *
 * NOTE: This strategy requires GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET
 * to be set in environment variables. If not set, a dummy strategy is created
 * that will fail gracefully.
 */
@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  private readonly logger = new Logger(GoogleStrategy.name);
  private readonly isConfigured: boolean;

  constructor(private readonly configService: ConfigService) {
    const clientID = configService.get<string>('GOOGLE_CLIENT_ID');
    const clientSecret = configService.get<string>('GOOGLE_CLIENT_SECRET');
    const callbackURL =
      configService.get<string>('GOOGLE_CALLBACK_URL') ||
      '/auth/google/callback';

    // If not configured, use placeholder values (strategy won't be used)
    super({
      clientID: clientID || 'not-configured',
      clientSecret: clientSecret || 'not-configured',
      callbackURL,
      scope: ['email', 'profile'],
    });

    this.isConfigured = !!(clientID && clientSecret);

    if (!this.isConfigured) {
      this.logger.warn(
        '⚠️ Google OAuth not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env',
      );
    } else {
      this.logger.log('✅ Google OAuth strategy initialized');
    }
  }

  /**
   * Validate the Google profile and extract user information.
   * This is called after Google successfully authenticates the user.
   */
  async validate(
    accessToken: string,
    refreshToken: string,
    profile: Profile,
    done: VerifyCallback,
  ): Promise<void> {
    if (!this.isConfigured) {
      this.logger.error(
        'Google OAuth not configured but validate() was called',
      );
      done(new Error('Google OAuth not configured'), undefined);
      return;
    }

    this.logger.log(`Google OAuth callback for user: ${profile.displayName}`);

    const { name, emails, photos, id } = profile;

    // Extract user data from Google profile
    const user = {
      googleId: id,
      email: emails?.[0]?.value,
      firstName: name?.givenName || '',
      lastName: name?.familyName || '',
      picture: photos?.[0]?.value || null,
      accessToken,
    };

    if (!user.email) {
      this.logger.error('No email found in Google profile');
      done(new Error('No email found in Google profile'), undefined);
      return;
    }

    this.logger.log(`Extracted Google user: ${user.email}`);
    done(null, user);
  }
}
