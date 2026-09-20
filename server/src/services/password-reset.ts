import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma.js';
import { env } from '../env.js';
import { badRequest } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { revokeSessions } from './revocations.js';
import { sendMail, siteUrl } from './mailer.js';
import { resetPassword } from './email-templates.js';

export interface ResetRequest {
  expiresAt: Date;
}

function hash(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Issues a single-use reset token. Callers must not reveal whether the email
 * existed — the route answers the same way either way.
 */
export async function requestReset(email: string): Promise<ResetRequest | null> {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
  if (!user || user.status !== 'ACTIVE') return null;

  // a new request invalidates any outstanding one
  await prisma.passwordResetToken.updateMany({
    where: { userId: user.id, usedAt: null },
    data: { usedAt: new Date() },
  });

  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + env.resetTokenMinutes * 60 * 1000);
  await prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash: hash(token), expiresAt } });

  // the token leaves the server exactly once, inside the email
  await sendMail({
    ...resetPassword({
      name: user.name,
      url: siteUrl(`/reset-password?token=${encodeURIComponent(token)}`),
      minutes: env.resetTokenMinutes,
    }),
    to: user.email,
    template: 'reset-password',
    userId: user.id,
  });
  logger.info({ component: 'auth', userId: user.id }, 'password reset link sent');
  return { expiresAt };
}

/** Consumes the token, sets the new password and signs every session out. */
export async function completeReset(token: string, newPassword: string): Promise<void> {
  const stored = await prisma.passwordResetToken.findUnique({ where: { tokenHash: hash(token) } });
  if (!stored || stored.usedAt || stored.expiresAt < new Date()) {
    throw badRequest('This reset link is invalid or has expired', 'invalid_token');
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  // the access tokens already issued have to stop working too, not just the
  // refresh tokens they would have been rotated from
  const open = await prisma.refreshToken.findMany({
    where: { userId: stored.userId, revokedAt: null },
    select: { id: true },
  });
  await prisma.$transaction([
    prisma.passwordResetToken.update({ where: { id: stored.id }, data: { usedAt: new Date() } }),
    prisma.user.update({ where: { id: stored.userId }, data: { passwordHash } }),
    prisma.refreshToken.updateMany({
      where: { userId: stored.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);
  revokeSessions(open.map((row) => row.id));
}
