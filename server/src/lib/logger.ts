import pino from 'pino';
import { env } from '../env.js';

/**
 * Anything that could carry a credential, a token or a payout destination is
 * redacted before it reaches a log sink. Add to this list, never remove from it.
 */
const redact = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.body.password',
  'req.body.newPassword',
  'req.body.currentPassword',
  'req.body.token',
  'req.body.refreshToken',
  'password',
  'passwordHash',
  'token',
  'refreshToken',
  'accessToken',
  'tokenHash',
  'jwtSecret',
  'jwtRefreshSecret',
  'DATABASE_URL',
];

export const logger = pino({
  level: env.logLevel,
  redact: { paths: redact, censor: '[redacted]' },
  base: { service: 'quantex-api' },
  formatters: {
    level: (label) => ({ level: label }),
  },
  ...(env.logPretty
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname,service' },
        },
      }
    : {}),
});

/** Child loggers keep each subsystem's lines greppable by `component`. */
export const log = {
  boot: logger.child({ component: 'boot' }),
  feed: logger.child({ component: 'feed' }),
  settlement: logger.child({ component: 'settlement' }),
  chain: logger.child({ component: 'chain' }),
  ws: logger.child({ component: 'ws' }),
  http: logger.child({ component: 'http' }),
  notify: logger.child({ component: 'notify' }),
  auth: logger.child({ component: 'auth' }),
  mail: logger.child({ component: 'mail' }),
};
