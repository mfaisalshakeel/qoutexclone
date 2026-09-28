/**
 * The GDPR export/erase pipeline against a real database: export reaches
 * across every table tied to the account, and erase scrubs PII while never
 * touching the financial ledger or trading history it sits next to.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const TEST_DB = process.env.TEST_DATABASE_URL;
if (TEST_DB) process.env.DATABASE_URL = TEST_DB;

const suite = TEST_DB ? describe : describe.skip;

suite('GDPR export and erasure', () => {
  let prisma: (typeof import('../../lib/prisma.js'))['prisma'];
  let gdpr: typeof import('../../services/gdpr.js');
  let storage: (typeof import('../../services/storage.js'))['storage'];

  const made: string[] = [];
  const savedRefs: string[] = [];

  const makeUser = async (overrides: Record<string, unknown> = {}) => {
    const user = await prisma.user.create({
      data: {
        email: `gdpr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.dev`,
        name: 'GDPR Test Trader',
        passwordHash: 'x',
        referralCode: Math.random().toString(36).slice(2, 10).toUpperCase(),
        ...overrides,
      },
    });
    made.push(user.id);
    return user;
  };

  beforeAll(async () => {
    prisma = (await import('../../lib/prisma.js')).prisma;
    gdpr = await import('../../services/gdpr.js');
    storage = (await import('../../services/storage.js')).storage;
  });

  afterAll(async () => {
    if (!prisma) return;
    for (const ref of savedRefs) await storage.delete(ref).catch(() => undefined);
    await prisma.trade.deleteMany({ where: { userId: { in: made } } });
    await prisma.transaction.deleteMany({ where: { userId: { in: made } } });
    await prisma.kycSubmission.deleteMany({ where: { userId: { in: made } } });
    await prisma.user.deleteMany({ where: { id: { in: made } } });
    await prisma.$disconnect();
  });

  it('exports every table tied to the account', async () => {
    const user = await makeUser();
    await prisma.notification.create({
      data: { userId: user.id, kind: 'SYSTEM', title: 'Hi', body: 'Welcome' },
    });
    await prisma.loginEvent.create({
      data: {
        userId: user.id,
        email: user.email,
        outcome: 'SUCCESS',
        device: 'Test',
        fingerprint: 'fp-export',
      },
    });

    const data = await gdpr.exportUserData(user.id);

    expect(data.account.email).toBe(user.email);
    expect(data.account).not.toHaveProperty('passwordHash');
    expect(data.account).not.toHaveProperty('twoFactorSecret');
    expect(data.activity.notifications).toHaveLength(1);
    expect(data.activity.loginHistory).toHaveLength(1);
  });

  it('refuses to export or erase an account that does not exist', async () => {
    await expect(gdpr.exportUserData('not-a-real-id')).rejects.toMatchObject({ status: 404 });
    await expect(gdpr.eraseUserData('not-a-real-id')).rejects.toMatchObject({ status: 404 });
  });

  it('refuses to erase a staff account', async () => {
    const admin = await makeUser({ role: 'ADMIN', adminRole: 'SUPPORT' });
    await expect(gdpr.eraseUserData(admin.id)).rejects.toMatchObject({ status: 400, code: 'not_a_trader' });
  });

  it('scrubs PII, revokes sessions, and deletes the KYC file — but never touches a trade or a transaction', async () => {
    const user = await makeUser();
    const originalEmail = user.email;

    const trade = await prisma.trade.create({
      data: {
        userId: user.id,
        assetId: (await prisma.asset.findFirstOrThrow()).id,
        symbol: 'BTCUSDT',
        accountType: 'REAL',
        direction: 'UP',
        stake: 1000,
        payoutPct: 85,
        entryPrice: 50000,
        durationSec: 60,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const transaction = await prisma.transaction.create({
      data: { userId: user.id, accountType: 'REAL', type: 'TRADE_STAKE', amount: -1000, balanceAfter: 9000 },
    });
    const { ref } = await storage.save('kyc', Buffer.from([0xff, 0xd8, 0xff]), '.jpg');
    savedRefs.push(ref);
    const kyc = await prisma.kycSubmission.create({
      data: {
        userId: user.id,
        fullName: 'Real Name',
        dateOfBirth: '1990-01-01',
        country: 'PK',
        address: 'Real address',
        documentType: 'PASSPORT',
        documentNumber: 'REAL123',
        documentRef: ref,
        status: 'APPROVED',
      },
    });
    const session = await prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: `gdpr-session-${Math.random()}`,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    const notification = await prisma.notification.create({
      data: { userId: user.id, kind: 'SYSTEM', title: 'Hi', body: 'Bye' },
    });

    await gdpr.eraseUserData(user.id);

    const anonymized = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(anonymized.email).not.toBe(originalEmail);
    expect(anonymized.email).toContain('deleted');
    expect(anonymized.name).not.toBe('GDPR Test Trader');

    // financial and trading history: untouched, still visible under this id
    const untouchedTrade = await prisma.trade.findUniqueOrThrow({ where: { id: trade.id } });
    expect(untouchedTrade.stake).toBe(1000);
    expect(untouchedTrade.userId).toBe(user.id);
    const untouchedTx = await prisma.transaction.findUniqueOrThrow({ where: { id: transaction.id } });
    expect(untouchedTx.amount).toBe(-1000);

    // KYC row survives (compliance record that verification happened) but its PII is gone
    const scrubbedKyc = await prisma.kycSubmission.findUniqueOrThrow({ where: { id: kyc.id } });
    expect(scrubbedKyc.fullName).not.toBe('Real Name');
    expect(scrubbedKyc.documentNumber).not.toBe('REAL123');
    expect(scrubbedKyc.documentRef).toBeNull();
    expect(scrubbedKyc.status).toBe('APPROVED'); // the decision itself is still on record
    expect(await storage.read(ref)).toBeNull(); // the actual file is gone

    // disposable rows: gone entirely
    expect(await prisma.notification.findUnique({ where: { id: notification.id } })).toBeNull();
    const sessionAfter = await prisma.refreshToken.findUnique({ where: { id: session.id } });
    expect(sessionAfter).toBeNull();
  });
});
