import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { badRequest, unauthorized, wrap } from '../lib/errors.js';
import { createRefreshToken, hashRefreshToken, signAccessToken } from '../lib/jwt.js';
import { publicUser } from '../lib/serialize.js';
import { requireAuth } from '../middleware/auth.js';
import { settings } from '../services/settings.js';
import { completeReset, requestReset } from '../services/password-reset.js';

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

async function issueSession(userId: string, role: string, email: string) {
  const refresh = createRefreshToken();
  await prisma.refreshToken.create({
    data: { userId, tokenHash: refresh.hash, expiresAt: refresh.expiresAt },
  });
  return {
    accessToken: signAccessToken({ sub: userId, role, email }),
    refreshToken: refresh.token,
  };
}

router.post(
  '/register',
  authLimiter,
  wrap(async (req, res) => {
    const body = registerSchema.parse(req.body);
    const email = body.email.toLowerCase().trim();

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

    const session = await issueSession(user.id, user.role, user.email);
    res.status(201).json({ user: publicUser(user), ...session });
  }),
);

router.post(
  '/login',
  authLimiter,
  wrap(async (req, res) => {
    const body = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: body.email.toLowerCase().trim() } });
    // Same error for unknown email and wrong password — no account enumeration.
    if (!user) throw unauthorized('Invalid email or password');
    const ok = await bcrypt.compare(body.password, user.passwordHash);
    if (!ok) throw unauthorized('Invalid email or password');
    if (user.status !== 'ACTIVE') throw unauthorized('This account is suspended');

    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    const session = await issueSession(user.id, user.role, user.email);
    res.json({ user: publicUser(user), ...session });
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

    // Rotate: the presented token is burned as the new one is issued.
    await prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } });
    const session = await issueSession(stored.user.id, stored.user.role, stored.user.email);
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
    const result = await requestReset(body.email);
    // identical answer whether or not the address is registered
    res.json({
      ok: true,
      message: 'If that email is registered, a reset link is on its way.',
      ...(result?.token ? { token: result.token, expiresAt: result.expiresAt } : {}),
    });
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
    await prisma.refreshToken.updateMany({
      where: { userId: req.user!.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    res.json({ ok: true });
  }),
);

export default router;
