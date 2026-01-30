export const HELP_CONSTANTS = {
  CONTACT_RATE_LIMIT: {
    IP: {
      KEY: 'contact:rate_limit:ip',
      MAX_ATTEMPTS: 5,
      TTL_SECONDS: 3600, // 1 hour - max 5 requests per hour per IP
    },
    EMAIL: {
      KEY: 'contact:rate_limit:email',
      MAX_ATTEMPTS: 3,
      TTL_SECONDS: 3600, // 1 hour - max 3 requests per hour per email
    },
    GLOBAL_IP: {
      KEY: 'contact:rate_limit:global_ip',
      MAX_ATTEMPTS: 20,
      TTL_SECONDS: 86400, // 24 hours - max 20 requests per day per IP
    },
  },
};
