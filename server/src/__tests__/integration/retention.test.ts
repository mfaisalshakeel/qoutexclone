/**
 * The retention sweeps against a real database: login history and expired
 * sessions get pruned past their window, and nothing inside it is touched.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const TEST_DB = process.env.TEST_DATABASE_URL;
if (TEST_DB) process.env.DATABASE_URL = TEST_DB;

const suite = TEST_DB ? describe : describe.skip;

suite('retention sweeps', () => {
  let prisma: (typeof import('../../lib/prisma.js'))['prisma'];
  let retention: typeof import('../../services/retention.js');

  const made: string[] = [];

  const makeUser = async () => {
    const user = await prisma.user.create({
      data: {
        email: `retention-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.dev`,
        name: 'Retention Test',
        passwordHash: 'x',
        referralCode: Math.random().toString(36).slice(2, 10).toUpperCase(),
      },
    });
    made.push(user.id);
    return user;
  };

  beforeAll(async () => {
    prisma = (await import('../../lib/prisma.js')).prisma;
    retention = await import('../../services/retention.js');
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.user.deleteMany({ where: { id: { in: made } } });
    await prisma.$disconnect();
  });

  it('removes login history past the retention window and leaves recent history alone', async () => {
    const user = await makeUser();
    const old = new Date(Date.now() - 200 * 86_400_000); // well past the 180-day default
    const recent = new Date();

    const [oldEvent, recentEvent] = await Promise.all([
      prisma.loginEvent.create({
        data: {
          userId: user.id,
          email: user.email,
          outcome: 'SUCCESS',
          device: 'Test device',
          fingerprint: 'test-fp-1',
          createdAt: old,
        },
      }),
      prisma.loginEvent.create({
        data: {
          userId: user.id,
          email: user.email,
          outcome: 'SUCCESS',
          device: 'Test device',
          fingerprint: 'test-fp-2',
          createdAt: recent,
        },
      }),
    ]);

    await retention.pruneLoginHistory();

    expect(await prisma.loginEvent.findUnique({ where: { id: oldEvent.id } })).toBeNull();
    expect(await prisma.loginEvent.findUnique({ where: { id: recentEvent.id } })).not.toBeNull();
  });

  it('removes an expired session and leaves a live one alone', async () => {
    const user = await makeUser();
    const [expired, live] = await Promise.all([
      prisma.refreshToken.create({
        data: {
          userId: user.id,
          tokenHash: `expired-${Math.random()}`,
          expiresAt: new Date(Date.now() - 60_000),
        },
      }),
      prisma.refreshToken.create({
        data: {
          userId: user.id,
          tokenHash: `live-${Math.random()}`,
          expiresAt: new Date(Date.now() + 86_400_000),
        },
      }),
    ]);

    await retention.pruneExpiredSessions();

    expect(await prisma.refreshToken.findUnique({ where: { id: expired.id } })).toBeNull();
    expect(await prisma.refreshToken.findUnique({ where: { id: live.id } })).not.toBeNull();
  });

  it('a revoked-but-not-yet-expired session survives the sweep', async () => {
    const user = await makeUser();
    const revoked = await prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: `revoked-${Math.random()}`,
        expiresAt: new Date(Date.now() + 86_400_000),
        revokedAt: new Date(),
      },
    });

    await retention.pruneExpiredSessions();

    expect(await prisma.refreshToken.findUnique({ where: { id: revoked.id } })).not.toBeNull();
  });
});
