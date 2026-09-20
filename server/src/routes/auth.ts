import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { badRequest, unauthorized, wrap } from '../lib/errors.js';
import {
  createRefreshToken,
  hashRefreshToken,
  signAccessToken,
  signChallengeToken,
  verifyChallengeToken,
} from '../lib/jwt.js';
import { publicUser } from '../lib/serialize.js';
import { requireAuth } from '../middleware/auth.js';
import { settings } from '../services/settings.js';
import { completeReset, requestReset } from '../services/password-reset.js';
import {
  alertNewDevice,
  assertPasswordAllowed,
  confirmEmail,
  contextOf,
  issueEmailVerification,
  recordLogin,
  revokeOtherSessions,
  verifySecondFactor,
  type RequestContext,
} from '../services/security.js';
import { describeDevice, fingerprint } from '../lib/device.js';
import { excludedUntil } from '../services/responsible.js';

const router = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  // read per request, so an operator can change it without a restart
  limit: () => settings.get('security.authAttemptsPer15Min'),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'rate_limited', message: 'Too many attempts, try again later' } },
});

const registerSchema = z.object({
  email: z.string().email().max(160),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
  name: z.string().min(2).max(60),
  country: z.string().max(60).optional(),
  referralCode: z.string().max(32).optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

function makeReferralCode(): string {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

/**
 * Opens a session, remembering the device it belongs to.
 *
 * What is stored is a label and a coarse network, not a tracking identifier:
 * enough for the trader to recognise a row in their device list and for the
 * platform to tell a familiar sign-in from a new one.
 */
async function issueSession(userId: string, role: string, email: string, context?: RequestContext) {
  const refresh = createRefreshToken();
  const row = await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: refresh.hash,
      expiresAt: refresh.expiresAt,
      ip: context?.ip,
      userAgent: context?.userAgent,
      device: describeDevice(context?.userAgent),
      fingerprint: context ? fingerprint({ userAgent: context.userAgent, ip: context.ip }) : null,
      lastUsedAt: new Date(),
    },
  });
  return {
    accessToken: signAccessToken({ sub: userId, role, email, sid: row.id }),
    refreshToken: refresh.token,
  };
}

router.post(
  '/register',
  authLimiter,
  wrap(async (req, res) => {
    const body = registerSchema.parse(req.body);
    const email = body.email.toLowerCase().trim();
    assertPasswordAllowed(body.password, { email, name: body.name });

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) throw badRequest('An account with this email already exists', 'email_taken');

    const referrer = body.referralCode
      ? await prisma.user.findUnique({ where: { referralCode: body.referralCode.toUpperCase() } })
      : null;

    const user = await prisma.user.create({
      data: {
        email,
        name: body.name.trim(),
        country: body.country?.trim(),
        passwordHash: await bcrypt.hash(body.password, 10),
        referralCode: makeReferralCode(),
        referredById: referrer?.id,
      },
    });

    const context = contextOf(req);
    await recordLogin({ email, outcome: 'SUCCESS', context, userId: user.id });
    // the link goes out even when verification is optional: an unconfirmed
    // address is the one thing an account cannot be recovered through
    if (settings.get('security.emailVerification') !== 'off') await issueEmailVerification(user);

    const session = await issueSession(user.id, user.role, user.email, context);
    res.status(201).json({ user: publicUser(user), ...session });
  }),
);

router.post(
  '/login',
  authLimiter,
  wrap(async (req, res) => {
    const body = loginSchema.parse(req.body);
    const email = body.email.toLowerCase().trim();
    const context = contextOf(req);
    const user = await prisma.user.findUnique({ where: { email } });

    // Same error for unknown email and wrong password — no account enumeration.
    if (!user) {
      await recordLogin({ email, outcome: 'UNKNOWN_EMAIL', context });
      throw unauthorized('Invalid email or password');
    }
    if (!(await bcrypt.compare(body.password, user.passwordHash))) {
      await recordLogin({ email, outcome: 'BAD_PASSWORD', context, userId: user.id });
      throw unauthorized('Invalid email or password');
    }
    if (user.status !== 'ACTIVE') {
      await recordLogin({ email, outcome: 'SUSPENDED', context, userId: user.id });
      throw unauthorized('This account is suspended');
    }

    // a self-excluded trader can still get at their money, so the door stays
    // open — the terminal is what closes, and it closes below
    const shut = await excludedUntil(user.id);
    if (shut) {
      await recordLogin({ email, outcome: 'EXCLUDED', context, userId: user.id });
    }

    // the password alone is not a session when a second factor is enrolled
    if (user.twoFactorEnabledAt) {
      await recordLogin({ email, outcome: 'TWO_FACTOR_REQUIRED', context, userId: user.id });
      res.json({ twoFactorRequired: true, challengeToken: signChallengeToken(user.id) });
      return;
    }

    res.json(await completeLogin(user, context));
  }),
);

/**
 * Everything that happens once both factors are satisfied: the history line,
 * the alert if this device is new, and the session itself.
 */
async function completeLogin(
  user: Awaited<ReturnType<typeof prisma.user.findUnique>>,
  context: RequestContext,
) {
  if (!user) throw unauthorized('Invalid email or password');
  const { newDevice } = await recordLogin({
    email: user.email,
    outcome: 'SUCCESS',
    context,
    userId: user.id,
  });
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  // a failed alert must never cost someone their sign-in
  if (newDevice) await alertNewDevice(user, context).catch(() => undefined);

  const session = await issueSession(user.id, user.role, user.email, context);
  return { user: publicUser(user), ...session, newDevice };
}

router.post(
  '/2fa',
  authLimiter,
  wrap(async (req, res) => {
    const body = z
      .object({ challengeToken: z.string().min(10), code: z.string().min(6).max(20) })
      .parse(req.body);

    const userId = verifyChallengeToken(body.challengeToken);
    if (!userId) throw unauthorized('That sign-in has expired. Enter your password again.');

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.status !== 'ACTIVE') throw unauthorized('This account is suspended');

    const context = contextOf(req);
    if (!(await verifySecondFactor(user, body.code))) {
      await recordLogin({ email: user.email, outcome: 'TWO_FACTOR_FAILED', context, userId: user.id });
      throw unauthorized('That code is not right');
    }

    res.json(await completeLogin(user, context));
  }),
);

router.post(
  '/verify-email',
  authLimiter,
  wrap(async (req, res) => {
    const body = z.object({ token: z.string().min(10) }).parse(req.body);
    const user = await confirmEmail(body.token);
    res.json({ ok: true, user: publicUser(user) });
  }),
);

router.post(
  '/refresh',
  wrap(async (req, res) => {
    const token = z.object({ refreshToken: z.string().min(10) }).parse(req.body).refreshToken;
    const stored = await prisma.refreshToken.findUnique({
      where: { tokenHash: hashRefreshToken(token) },
      include: { user: true },
    });
    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) throw unauthorized('Session expired');
    if (stored.user.status !== 'ACTIVE') throw unauthorized('This account is suspended');

    // Rotate: the presented token is burned as the new one is issued. The new
    // row inherits the device, so rotating does not fill the list with strangers.
    const context = contextOf(req);
    await prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } });
    const session = await issueSession(stored.user.id, stored.user.role, stored.user.email, context);
    res.json({ user: publicUser(stored.user), ...session });
  }),
);

router.post(
  '/logout',
  wrap(async (req, res) => {
    const parsed = z.object({ refreshToken: z.string().optional() }).safeParse(req.body ?? {});
    if (parsed.success && parsed.data.refreshToken) {
      await prisma.refreshToken.updateMany({
        where: { tokenHash: hashRefreshToken(parsed.data.refreshToken), revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    res.json({ ok: true });
  }),
);

router.post(
  '/forgot-password',
  authLimiter,
  wrap(async (req, res) => {
    const body = z.object({ email: z.string().email() }).parse(req.body);
    await requestReset(body.email);
    // identical answer whether or not the address is registered
    res.json({ ok: true, message: 'If that email is registered, a reset link is on its way.' });
  }),
);

router.post(
  '/reset-password',
  authLimiter,
  wrap(async (req, res) => {
    const body = z
      .object({ token: z.string().min(10), password: z.string().min(8).max(128) })
      .parse(req.body);
    await completeReset(body.token, body.password);
    res.json({ ok: true });
  }),
);

router.post(
  '/logout-all',
  requireAuth,
  wrap(async (req, res) => {
    // null keeps nothing back: this one signs out everywhere, here included
    const count = await revokeOtherSessions(req.user!.id, null);
    res.json({ ok: true, count });
  }),
);

export default router;
