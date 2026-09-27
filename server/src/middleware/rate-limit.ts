import rateLimit, { type RateLimitRequestHandler } from 'express-rate-limit';
import type { SettingKey } from '../services/settings.js';
import { settings } from '../services/settings.js';

/**
 * A rate limit keyed by account rather than address, for routes that already
 * sit behind `requireAuth`. IP-based limits (see `authLimiter` in
 * `routes/auth.ts`) protect the sign-in surface, where there is no account
 * yet to key on; once a request carries a session, keying on the account
 * catches an attacker who rotates addresses but not sessions, and never
 * punishes an office or a carrier-grade NAT sharing one outbound IP.
 */
export function perAccountLimiter(options: {
  windowMs: number;
  settingKey: SettingKey;
  message: string;
}): RateLimitRequestHandler {
  return rateLimit({
    windowMs: options.windowMs,
    limit: () => settings.get(options.settingKey) as number,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.user!.id,
    message: { error: { code: 'rate_limited', message: options.message } },
  });
}
