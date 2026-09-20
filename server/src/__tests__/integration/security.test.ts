/**
 * Account security against a real database.
 *
 * The parts worth proving here are the ones that only exist across rows: a
 * backup code that can be spent exactly once, an enrolment that is not live
 * until a code confirms it, a device list that belongs to one account, and a
 * verification link that cannot be replayed.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { totp } from '../../lib/totp.js';

const TEST_DB = process.env.TEST_DATABASE_URL;
if (TEST_DB) process.env.DATABASE_URL = TEST_DB;

const suite = TEST_DB ? describe : describe.skip;

suite('account security', () => {
  let prisma: (typeof import('../../lib/prisma.js'))['prisma'];
  let security: typeof import('../../services/security.js');

  const made: string[] = [];

  const makeUser = async (overrides: Record<string, unknown> = {}) => {
    const user = await prisma.user.create({
      data: {
        email: `sec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.dev`,
        name: 'Security Trader',
        // bcrypt hash of "Harbour7Lantern"
        passwordHash: '$2a$10$bSIZ9C1./4i4kIN8tDRfq.Ucfwsoq0mo2lIjp07oY8AnqfZ6sezJ6',
        referralCode: Math.random().toString(36).slice(2, 10).toUpperCase(),
        ...overrides,
      },
    });
    made.push(user.id);
    return user;
  };

  const reload = (id: string) => prisma.user.findUniqueOrThrow({ where: { id } });

  beforeAll(async () => {
    prisma = (await import('../../lib/prisma.js')).prisma;
    security = await import('../../services/security.js');
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.user.deleteMany({ where: { id: { in: made } } });
    await prisma.$disconnect();
  });

  it('confirms an address once and refuses the same link again', async () => {
    const user = await makeUser();
    const issued = await security.issueEmailVerification(user);
    const token = await prisma.emailVerificationToken.findFirstOrThrow({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(issued.expiresAt.getTime()).toBeGreaterThan(Date.now());

    // the service hashes what it stores, so the raw token is rebuilt from the
    // one the mail carried: the outbox row is the only place it survives
    const message = await prisma.emailMessage.findFirstOrThrow({
      where: { userId: user.id, template: 'verify-email' },
      orderBy: { createdAt: 'desc' },
    });
    const raw = /token=([^"&\s]+)/.exec(message.text)?.[1];
    expect(raw).toBeTruthy();

    const confirmed = await security.confirmEmail(decodeURIComponent(raw!));
    expect(confirmed.emailVerifiedAt).not.toBeNull();
    await expect(security.confirmEmail(decodeURIComponent(raw!))).rejects.toThrow();
    expect((await prisma.emailVerificationToken.findUniqueOrThrow({ where: { id: token.id } })).usedAt).not.toBeNull();
  });

  it('burns an outstanding link when a new one is asked for', async () => {
    const user = await makeUser();
    await security.issueEmailVerification(user);
    await security.issueEmailVerification(user);
    const live = await prisma.emailVerificationToken.count({ where: { userId: user.id, usedAt: null } });
    expect(live).toBe(1);
  });

  it('does not turn two-factor on until a code proves the app has the secret', async () => {
    const user = await makeUser();
    const { secret } = await security.startTwoFactor(user);

    const pending = await reload(user.id);
    expect(pending.twoFactorEnabledAt).toBeNull();
    expect(pending.twoFactorSecret).toBeNull();
    expect(pending.twoFactorPending).toBe(secret);

    await expect(security.enableTwoFactor(pending, '000000')).rejects.toThrow();
    expect((await reload(user.id)).twoFactorEnabledAt).toBeNull();

    const codes = await security.enableTwoFactor(pending, totp(secret));
    expect(codes).toHaveLength(security.BACKUP_CODE_COUNT);

    const live = await reload(user.id);
    expect(live.twoFactorSecret).toBe(secret);
    expect(live.twoFactorPending).toBeNull();
    expect(live.twoFactorEnabledAt).not.toBeNull();
  });

  it('spends a backup code exactly once', async () => {
    const user = await makeUser();
    const { secret } = await security.startTwoFactor(user);
    const codes = await security.enableTwoFactor(await reload(user.id), totp(secret));
    const live = await reload(user.id);

    expect(await security.backupCodesLeft(user.id)).toBe(security.BACKUP_CODE_COUNT);
    // spacing and case are the user's business, not the check's
    expect(await security.verifySecondFactor(live, codes[0].toLowerCase().replace('-', ' '))).toBe(true);
    expect(await security.verifySecondFactor(live, codes[0])).toBe(false);
    expect(await security.backupCodesLeft(user.id)).toBe(security.BACKUP_CODE_COUNT - 1);
  });

  it('never lets two simultaneous attempts spend the same backup code', async () => {
    const user = await makeUser();
    const { secret } = await security.startTwoFactor(user);
    const codes = await security.enableTwoFactor(await reload(user.id), totp(secret));
    const live = await reload(user.id);

    const results = await Promise.all([
      security.verifySecondFactor(live, codes[0]),
      security.verifySecondFactor(live, codes[0]),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await security.backupCodesLeft(user.id)).toBe(security.BACKUP_CODE_COUNT - 1);
  });

  it('replaces the whole set when backup codes are regenerated', async () => {
    const user = await makeUser();
    const { secret } = await security.startTwoFactor(user);
    const first = await security.enableTwoFactor(await reload(user.id), totp(secret));
    const second = await security.regenerateBackupCodes(await reload(user.id), totp(secret));

    expect(second).not.toEqual(first);
    const live = await reload(user.id);
    expect(await security.verifySecondFactor(live, first[0])).toBe(false);
    expect(await security.verifySecondFactor(live, second[0])).toBe(true);
  });

  it('turns two-factor off only with the password and a code, and clears the codes', async () => {
    const user = await makeUser();
    const { secret } = await security.startTwoFactor(user);
    await security.enableTwoFactor(await reload(user.id), totp(secret));

    await expect(security.disableTwoFactor(await reload(user.id), 'wrong', totp(secret))).rejects.toThrow();
    expect((await reload(user.id)).twoFactorEnabledAt).not.toBeNull();

    await security.disableTwoFactor(await reload(user.id), 'Harbour7Lantern', totp(secret));
    const off = await reload(user.id);
    expect(off.twoFactorEnabledAt).toBeNull();
    expect(off.twoFactorSecret).toBeNull();
    expect(await prisma.backupCode.count({ where: { userId: user.id } })).toBe(0);
  });

  it('calls a device new once and familiar afterwards', async () => {
    const user = await makeUser();
    const context = { ip: '81.2.69.142', userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/131.0.0.0' };

    const first = await security.recordLogin({ email: user.email, outcome: 'SUCCESS', context, userId: user.id });
    expect(first.newDevice).toBe(true);

    // same browser, different address inside the same network
    const again = await security.recordLogin({
      email: user.email,
      outcome: 'SUCCESS',
      context: { ...context, ip: '81.2.69.9' },
      userId: user.id,
    });
    expect(again.newDevice).toBe(false);

    const elsewhere = await security.recordLogin({
      email: user.email,
      outcome: 'SUCCESS',
      context: { ...context, ip: '203.0.113.5' },
      userId: user.id,
    });
    expect(elsewhere.newDevice).toBe(true);
  });

  it('keeps failed attempts in the history without calling them a device', async () => {
    const user = await makeUser();
    const context = { ip: '203.0.113.9', userAgent: 'curl/8.4.0' };
    await security.recordLogin({ email: user.email, outcome: 'BAD_PASSWORD', context, userId: user.id });

    const events = await security.listLoginHistory(user.id);
    expect(events[0].outcome).toBe('BAD_PASSWORD');
    expect(events[0].newDevice).toBe(false);
  });

  it('lists only this account\'s sessions, and revokes another account\'s never', async () => {
    const mine = await makeUser();
    const theirs = await makeUser();
    const session = async (userId: string) =>
      prisma.refreshToken.create({
        data: {
          userId,
          tokenHash: Math.random().toString(36).slice(2) + Date.now(),
          expiresAt: new Date(Date.now() + 86_400_000),
          device: 'Chrome on Windows',
          ip: '81.2.69.142',
        },
      });

    const a = await session(mine.id);
    await session(mine.id);
    const other = await session(theirs.id);

    const list = await security.listSessions(mine.id, a.id);
    expect(list).toHaveLength(2);
    expect(list.filter((row) => row.current)).toHaveLength(1);

    // an id from another account must not be revokable, even though it exists
    await expect(security.revokeSession(mine.id, other.id)).rejects.toThrow();
    expect((await prisma.refreshToken.findUniqueOrThrow({ where: { id: other.id } })).revokedAt).toBeNull();

    const count = await security.revokeOtherSessions(mine.id, a.id);
    expect(count).toBe(1);
    expect((await security.listSessions(mine.id, a.id))).toHaveLength(1);
  });
});
