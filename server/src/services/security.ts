import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { User } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { badRequest, unauthorized } from '../lib/errors.js';
import { describeDevice, fingerprint } from '../lib/device.js';
import { generateSecret, otpauthUri, verifyTotp } from '../lib/totp.js';
import { checkPassword, type PasswordPolicy } from '../lib/password-policy.js';
import { log } from '../lib/logger.js';
import { sendMail, siteUrl } from './mailer.js';
import { newDeviceAlert, twoFactorChanged, verifyEmail } from './email-templates.js';
import { settings } from './settings.js';
import { revokeSessions } from './revocations.js';

/**
 * Account security: proving the address, proving the person, and showing them
 * everywhere their account is signed in.
 *
 * Everything here is written so the trader can see it afterwards — a device
 * list, a login history, an email when something changes. Security a user
 * cannot inspect is security they have to take on trust.
 */

/** How many backup codes an enrolment produces. */
export const BACKUP_CODE_COUNT = 10;

export interface RequestContext {
  ip: string;
  userAgent: string | null;
}

export function contextOf(request: {
  ip?: string;
  socket?: { remoteAddress?: string };
  get(name: string): string | undefined;
}): RequestContext {
  return {
    ip: (request.ip ?? request.socket?.remoteAddress ?? '').replace(/^::ffff:/, '') || 'unknown',
    userAgent: request.get('user-agent') ?? null,
  };
}

/** The password rules an operator has set, in the shape the checker takes. */
export function passwordPolicy(): PasswordPolicy {
  return {
    minLength: settings.get('security.passwordMinLength'),
    requireMixedCase: settings.get('security.passwordRequireMixedCase'),
    requireNumber: settings.get('security.passwordRequireNumber'),
    requireSymbol: settings.get('security.passwordRequireSymbol'),
  };
}

/** Validates a new password against the policy, or explains why it will not do. */
export function assertPasswordAllowed(
  password: string,
  context: { email?: string; name?: string } = {},
): void {
  const result = checkPassword(password, passwordPolicy(), context);
  if (!result.ok) throw badRequest(result.problems.join('. '), 'weak_password');
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/* -------------------------------------------------------------------------- */
/* Email verification                                                         */
/* -------------------------------------------------------------------------- */

export interface VerificationIssued {
  expiresAt: Date;
}

/**
 * Issues a fresh verification link and mails it.
 *
 * Any outstanding link is burned first: one live link at a time means a stolen
 * old email cannot be used once a new one has been asked for.
 */
export async function issueEmailVerification(user: User): Promise<VerificationIssued> {
  if (user.emailVerifiedAt) throw badRequest('This address is already confirmed', 'already_verified');

  await prisma.emailVerificationToken.updateMany({
    where: { userId: user.id, usedAt: null },
    data: { usedAt: new Date() },
  });

  const hours = settings.get('security.emailVerificationHours');
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);
  await prisma.emailVerificationToken.create({
    data: { userId: user.id, tokenHash: hashToken(token), expiresAt },
  });

  const url = siteUrl(`/verify-email?token=${encodeURIComponent(token)}`);
  const message = verifyEmail({ name: user.name, url, hours });
  await sendMail({ ...message, to: user.email, template: 'verify-email', userId: user.id });

  return { expiresAt };
}

/** Consumes a verification link. Idempotent for a token already spent. */
export async function confirmEmail(token: string): Promise<User> {
  const stored = await prisma.emailVerificationToken.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!stored || stored.usedAt || stored.expiresAt < new Date()) {
    throw badRequest('This confirmation link is invalid or has expired', 'invalid_token');
  }
  const [, user] = await prisma.$transaction([
    prisma.emailVerificationToken.update({ where: { id: stored.id }, data: { usedAt: new Date() } }),
    prisma.user.update({ where: { id: stored.userId }, data: { emailVerifiedAt: new Date() } }),
  ]);
  return user;
}

/* -------------------------------------------------------------------------- */
/* Devices, sessions and login history                                         */
/* -------------------------------------------------------------------------- */

export type LoginOutcome =
  | 'SUCCESS'
  | 'BAD_PASSWORD'
  | 'UNKNOWN_EMAIL'
  | 'SUSPENDED'
  | 'TWO_FACTOR_REQUIRED'
  | 'TWO_FACTOR_FAILED'
  /** Signed in while self-excluded: allowed, so they can still withdraw. */
  | 'EXCLUDED';

/** Whether this account has ever successfully signed in from this device. */
export async function isKnownDevice(userId: string, print: string): Promise<boolean> {
  const seen = await prisma.loginEvent.findFirst({
    where: { userId, fingerprint: print, outcome: 'SUCCESS' },
    select: { id: true },
  });
  return seen !== null;
}

/**
 * Writes one line of login history, and says whether the device was new.
 *
 * The history is kept for failures too: a run of `BAD_PASSWORD` rows from an
 * address the account has never used is the thing a trader most needs to see.
 */
export async function recordLogin(options: {
  email: string;
  outcome: LoginOutcome;
  context: RequestContext;
  userId?: string;
}): Promise<{ newDevice: boolean; fingerprint: string }> {
  const print = fingerprint({ userAgent: options.context.userAgent, ip: options.context.ip });
  const newDevice =
    options.outcome === 'SUCCESS' && options.userId ? !(await isKnownDevice(options.userId, print)) : false;

  await prisma.loginEvent.create({
    data: {
      userId: options.userId,
      email: options.email,
      outcome: options.outcome,
      ip: options.context.ip,
      userAgent: options.context.userAgent,
      device: describeDevice(options.context.userAgent),
      fingerprint: print,
      newDevice,
    },
  });

  return { newDevice, fingerprint: print };
}

/** Tells a trader their account was reached from somewhere it has not been. */
export async function alertNewDevice(user: User, context: RequestContext): Promise<void> {
  if (!settings.get('security.newDeviceAlerts')) return;
  const message = newDeviceAlert({
    name: user.name,
    device: describeDevice(context.userAgent),
    ip: context.ip,
    at: new Date(),
    url: siteUrl('/account/security'),
  });
  await sendMail({ ...message, to: user.email, template: 'new-device', userId: user.id });
}

export interface SessionView {
  id: string;
  device: string;
  ip: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date;
  /** The session making the request — it is marked rather than offered. */
  current: boolean;
}

export async function listSessions(userId: string, currentId: string | null): Promise<SessionView[]> {
  const rows = await prisma.refreshToken.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  return rows.map((row) => ({
    id: row.id,
    device: row.device ?? describeDevice(row.userAgent),
    ip: row.ip,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    expiresAt: row.expiresAt,
    current: currentId !== null && row.id === currentId,
  }));
}

/** Revokes one session. Ownership is checked here, not at the route. */
export async function revokeSession(userId: string, id: string): Promise<void> {
  const result = await prisma.refreshToken.updateMany({
    where: { id, userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (result.count === 0) throw badRequest('That session is already signed out', 'not_found');
  revokeSessions([id]);
}

/** Signs out everywhere except the session asking. */
export async function revokeOtherSessions(userId: string, keepId: string | null): Promise<number> {
  const where = { userId, revokedAt: null, ...(keepId ? { NOT: { id: keepId } } : {}) };
  // the ids are read first: `updateMany` returns a count, and the access
  // tokens already out there are keyed by id
  const doomed = await prisma.refreshToken.findMany({ where, select: { id: true } });
  const result = await prisma.refreshToken.updateMany({ where, data: { revokedAt: new Date() } });
  revokeSessions(doomed.map((row) => row.id));
  return result.count;
}

export async function listLoginHistory(userId: string, limit = 25) {
  return prisma.loginEvent.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: Math.min(Math.max(limit, 1), 100),
    select: {
      id: true,
      outcome: true,
      ip: true,
      device: true,
      newDevice: true,
      createdAt: true,
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Two-factor authentication                                                   */
/* -------------------------------------------------------------------------- */

/** Codes are compared without their spacing, so typing is forgiving. */
function normaliseBackupCode(code: string): string {
  return code.replace(/[^a-z0-9]/gi, '').toUpperCase();
}

function randomBackupCode(): string {
  // ten hex characters in two groups: short enough to copy out by hand,
  // long enough that guessing one is hopeless
  const raw = crypto.randomBytes(5).toString('hex').toUpperCase();
  return `${raw.slice(0, 5)}-${raw.slice(5)}`;
}

export interface Enrolment {
  secret: string;
  otpauthUrl: string;
}

/**
 * Starts enrolment.
 *
 * The secret is held as *pending* until a code proves the app has it, so a
 * half-finished enrolment can never lock someone out of their own account.
 */
export async function startTwoFactor(user: User): Promise<Enrolment> {
  if (user.twoFactorEnabledAt) throw badRequest('Two-factor is already on', 'already_enabled');
  const secret = generateSecret();
  await prisma.user.update({ where: { id: user.id }, data: { twoFactorPending: secret } });
  return {
    secret,
    otpauthUrl: otpauthUri({
      secret,
      account: user.email,
      issuer: settings.get('general.siteName'),
    }),
  };
}

/** Confirms enrolment with a code from the app, and hands back backup codes. */
export async function enableTwoFactor(user: User, code: string): Promise<string[]> {
  if (user.twoFactorEnabledAt) throw badRequest('Two-factor is already on', 'already_enabled');
  if (!user.twoFactorPending) throw badRequest('Start the setup again', 'not_started');
  if (!verifyTotp(user.twoFactorPending, code)) {
    throw badRequest('That code is not right. Check your app and try the next one.', 'bad_code');
  }

  const codes = Array.from({ length: BACKUP_CODE_COUNT }, randomBackupCode);
  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: {
        twoFactorSecret: user.twoFactorPending,
        twoFactorPending: null,
        twoFactorEnabledAt: new Date(),
      },
    }),
    prisma.backupCode.deleteMany({ where: { userId: user.id } }),
    prisma.backupCode.createMany({
      data: await Promise.all(
        codes.map(async (plain) => ({
          userId: user.id,
          codeHash: await bcrypt.hash(normaliseBackupCode(plain), 10),
        })),
      ),
    }),
  ]);

  await sendMail({
    ...twoFactorChanged({ name: user.name, enabled: true, url: siteUrl('/account/security') }),
    to: user.email,
    template: 'two-factor-on',
    userId: user.id,
  });
  return codes;
}

/** Turns it off. The password is asked for again, and a code as well. */
export async function disableTwoFactor(user: User, password: string, code: string): Promise<void> {
  if (!user.twoFactorEnabledAt) throw badRequest('Two-factor is not on', 'not_enabled');
  if (!(await bcrypt.compare(password, user.passwordHash))) throw unauthorized('That password is not right');
  if (!(await verifySecondFactor(user, code))) throw badRequest('That code is not right', 'bad_code');

  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { twoFactorSecret: null, twoFactorPending: null, twoFactorEnabledAt: null },
    }),
    prisma.backupCode.deleteMany({ where: { userId: user.id } }),
  ]);

  await sendMail({
    ...twoFactorChanged({ name: user.name, enabled: false, url: siteUrl('/account/security') }),
    to: user.email,
    template: 'two-factor-off',
    userId: user.id,
  });
}

/** A fresh set of backup codes, which invalidates the old set. */
export async function regenerateBackupCodes(user: User, code: string): Promise<string[]> {
  if (!user.twoFactorEnabledAt) throw badRequest('Two-factor is not on', 'not_enabled');
  if (!(await verifySecondFactor(user, code))) throw badRequest('That code is not right', 'bad_code');

  const codes = Array.from({ length: BACKUP_CODE_COUNT }, randomBackupCode);
  await prisma.$transaction([
    prisma.backupCode.deleteMany({ where: { userId: user.id } }),
    prisma.backupCode.createMany({
      data: await Promise.all(
        codes.map(async (plain) => ({
          userId: user.id,
          codeHash: await bcrypt.hash(normaliseBackupCode(plain), 10),
        })),
      ),
    }),
  ]);
  return codes;
}

/** How many backup codes are still unused. */
export async function backupCodesLeft(userId: string): Promise<number> {
  return prisma.backupCode.count({ where: { userId, usedAt: null } });
}

/**
 * Accepts either a code from the authenticator app or one of the backup codes.
 *
 * A backup code is spent the moment it matches, in an update that only touches
 * a row still marked unused — two simultaneous attempts cannot both win.
 */
export async function verifySecondFactor(user: User, code: string): Promise<boolean> {
  const given = code.trim();
  if (!given) return false;
  if (user.twoFactorSecret && verifyTotp(user.twoFactorSecret, given)) return true;

  const candidates = await prisma.backupCode.findMany({ where: { userId: user.id, usedAt: null } });
  for (const candidate of candidates) {
    if (!(await bcrypt.compare(normaliseBackupCode(given), candidate.codeHash))) continue;
    const spent = await prisma.backupCode.updateMany({
      where: { id: candidate.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (spent.count === 1) {
      log.auth.info({ userId: user.id }, 'signed in with a backup code');
      return true;
    }
  }
  return false;
}
