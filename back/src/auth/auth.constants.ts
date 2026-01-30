import { JwtAuthGuard } from './guards/jwt-auth.guard';

export const AUTH_CONSTANTS = {
  RATE_LIMIT: {
    IP: {
      KEY: 'register:rate_limit:ip',
      MAX_ATTEMPTS: 10,
      TTL_SECONDS: 3600, // 1 hour
    },
    EMAIL: {
      KEY: 'register:rate_limit:email',
      MAX_ATTEMPTS: 5,
      TTL_SECONDS: 600, // 10 minutes
    },

    IP_LOGIN: {
      KEY: 'login:rate_limit:ip',
      MAX_ATTEMPTS: 10,
      TTL_SECONDS: 3600, // 1 hour window
    },
    EMAIL_LOGIN: {
      KEY: 'login:rate_limit:email',
      MAX_ATTEMPTS: 6,
      TTL_SECONDS: 1800, // 30 minutes window
    },

    FORGOT_PASSWORD: {
      KEY: 'forgot_password:rate_limit',
      MAX_ATTEMPTS: 3,
      TTL_SECONDS: 3600, // 1 hour
    },
    RESET_PASSWORD: {
      KEY: 'reset_password:rate_limit',
      MAX_ATTEMPTS: 5,
      TTL_SECONDS: 3600, // 1 hour (attempts on token brute force)
    },
    EMAIL_CHANGE: {
      KEY: 'email_change:rate_limit',
      MAX_ATTEMPTS: 3,
      TTL_SECONDS: 86400, // 24 hours
    },
  },

  REGISTER_SESSION: {
    KEY: 'register:session',
    MAX_ATTEMPTS: 5,
    TTL_SECONDS: 900, // 15 minutes
  },

  JWT: {
    ACCESS_TOKEN_EXPIRE: 900000, // 15m
    REFRESH_TOKEN_EXPIRE: 432000000, // 5 days
  },

  ADMIN_2FA_SESSION: {
    KEY: 'login:2fa:admin',
    MAX_ATTEMPTS: 3,
    TTL_SECONDS: 600, // 10 minutes
  },
};
