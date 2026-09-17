import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma.js';
import { env } from '../env.js';
import { badRequest } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

export interface ResetRequest {
  /** present only while EXPOSE_RESET_TOKEN is on (no mailer configured) */
  token?: string;
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

  if (!env.exposeResetToken) {
    // hand off to your mailer here; the token never leaves the server otherwise
    logger.info({ component: 'auth', userId: user.id }, 'password reset token issued (no mailer configured)');
    return { expiresAt };
  }
  return { token, expiresAt };
}

/** Consumes the token, sets the new password and signs every session out. */
export async function completeReset(token: string, newPassword: string): Promise<void> {
  const stored = await prisma.passwordResetToken.findUnique({ where: { tokenHash: hash(token) } });
  if (!stored || stored.usedAt || stored.expiresAt < new Date()) {
    throw badRequest('This reset link is invalid or has expired', 'invalid_token');
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await prisma.$transaction([
    prisma.passwordResetToken.update({ where: { id: stored.id }, data: { usedAt: new Date() } }),
    prisma.user.update({ where: { id: stored.userId }, data: { passwordHash } }),
    prisma.refreshToken.updateMany({
      where: { userId: stored.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);
}
