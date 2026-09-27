/**
 * Route-level authorisation, against a real running app and a real database —
 * the boundary every other integration test skips, since they all call
 * service functions directly rather than going through `requireAuth`/
 * `requireAdmin`/the route's own ownership check. This is not exhaustive
 * coverage of every route in the app (see docs/PROGRESS.md's Security review
 * entry for what is and is not covered); it proves the three shapes an authz
 * bug in this codebase actually takes: no session at all, the wrong role, and
 * the right role on someone else's resource (IDOR).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

const TEST_DB = process.env.TEST_DATABASE_URL;
if (TEST_DB) process.env.DATABASE_URL = TEST_DB;

const suite = TEST_DB ? describe : describe.skip;

suite('route authorisation', () => {
  let app: Express;
  let prisma: (typeof import('../../lib/prisma.js'))['prisma'];
  let signAccessToken: (typeof import('../../lib/jwt.js'))['signAccessToken'];

  const made: string[] = [];

  const makeUser = async (overrides: Record<string, unknown> = {}) => {
    const user = await prisma.user.create({
      data: {
        email: `authz-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.dev`,
        name: 'Authz Test',
        passwordHash: 'x',
        referralCode: Math.random().toString(36).slice(2, 10).toUpperCase(),
        ...overrides,
      },
    });
    made.push(user.id);
    return user;
  };

  const tokenFor = (user: { id: string; role: string; email: string }) =>
    signAccessToken({ sub: user.id, role: user.role, email: user.email });

  const authed = (user: { id: string; role: string; email: string }) => `Bearer ${tokenFor(user)}`;

  beforeAll(async () => {
    const appModule = await import('../../app.js');
    app = appModule.createApp();
    prisma = (await import('../../lib/prisma.js')).prisma;
    signAccessToken = (await import('../../lib/jwt.js')).signAccessToken;
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.withdrawal.deleteMany({ where: { userId: { in: made } } });
    await prisma.deposit.deleteMany({ where: { userId: { in: made } } });
    await prisma.notification.deleteMany({ where: { userId: { in: made } } });
    await prisma.user.deleteMany({ where: { id: { in: made } } });
    await prisma.$disconnect();
  });

  describe('no session at all', () => {
    it('refuses /api/me with no Authorization header', async () => {
      const res = await request(app).get('/api/me');
      expect(res.status).toBe(401);
    });

    it('refuses the wallet with no Authorization header', async () => {
      const res = await request(app).get('/api/wallet/balances');
      expect(res.status).toBe(401);
    });

    it('refuses every admin route with no Authorization header', async () => {
      const res = await request(app).get('/api/admin/kyc');
      expect(res.status).toBe(401);
    });

    it('refuses a garbage bearer token the same way as none at all', async () => {
      const res = await request(app).get('/api/me').set('Authorization', 'Bearer not-a-real-token');
      expect(res.status).toBe(401);
    });
  });

  describe('the wrong role', () => {
    it('blocks an ordinary trader from the admin area entirely, whatever the route', async () => {
      const trader = await makeUser();
      const res = await request(app).get('/api/admin/kyc').set('Authorization', authed(trader));
      expect(res.status).toBe(403);
    });

    it("blocks an ordinary trader from another trader's KYC document, even by guessing an id", async () => {
      const trader = await makeUser();
      const stranger = await makeUser();
      const submission = await prisma.kycSubmission.create({
        data: {
          userId: stranger.id,
          fullName: 'Stranger Trader',
          dateOfBirth: '1990-01-01',
          country: 'PK',
          address: '1 Somewhere',
          documentType: 'PASSPORT',
          documentNumber: 'X1',
          documentRef: 'kyc/does-not-matter.jpg',
          status: 'PENDING',
        },
      });
      const res = await request(app)
        .get(`/api/admin/kyc/${submission.id}/document`)
        .set('Authorization', authed(trader));
      // admin-only route: a non-admin never reaches the ownership question at all
      expect(res.status).toBe(403);
      await prisma.kycSubmission.delete({ where: { id: submission.id } });
    });

    it('an admin with the wrong permission area is blocked, an admin with the right one is not', async () => {
      const supportAdmin = await makeUser({
        role: 'ADMIN',
        adminRole: 'SUPPORT',
        twoFactorEnabledAt: new Date(),
      });
      const financeAdmin = await makeUser({
        role: 'ADMIN',
        adminRole: 'FINANCE',
        twoFactorEnabledAt: new Date(),
      });

      // /kyc requires 'support' — finance is refused, support is let through
      const blocked = await request(app).get('/api/admin/kyc').set('Authorization', authed(financeAdmin));
      expect(blocked.status).toBe(403);

      const allowed = await request(app).get('/api/admin/kyc').set('Authorization', authed(supportAdmin));
      expect(allowed.status).toBe(200);
    });
  });

  describe('the right role, someone else’s resource (IDOR)', () => {
    it('never confirms another trader’s deposit exists, let alone lets it be marked paid', async () => {
      const owner = await makeUser();
      const stranger = await makeUser();
      const deposit = await prisma.deposit.create({
        data: {
          userId: owner.id,
          currency: 'USDT',
          network: 'TRC20',
          address: 'T-not-real',
          status: 'AWAITING_PAYMENT',
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        },
      });

      const res = await request(app)
        .post(`/api/wallet/deposits/${deposit.id}/simulate-payment`)
        .set('Authorization', authed(stranger));
      // not-found, not forbidden: existence is not confirmed to a non-owner
      expect(res.status).toBe(404);

      const untouched = await prisma.deposit.findUniqueOrThrow({ where: { id: deposit.id } });
      expect(untouched.status).toBe('AWAITING_PAYMENT');
    });

    it('never lets a trader cancel another trader’s withdrawal', async () => {
      const owner = await makeUser();
      const stranger = await makeUser();
      const withdrawal = await prisma.withdrawal.create({
        data: {
          userId: owner.id,
          currency: 'USDT',
          network: 'TRC20',
          address: 'T-not-real',
          amount: 5000,
          netAmount: 5000,
          rate: 1,
          cryptoAmount: '5000',
          status: 'PENDING',
        },
      });

      const res = await request(app)
        .post(`/api/wallet/withdrawals/${withdrawal.id}/cancel`)
        .set('Authorization', authed(stranger));
      expect(res.status).toBe(404);

      const untouched = await prisma.withdrawal.findUniqueOrThrow({ where: { id: withdrawal.id } });
      expect(untouched.status).toBe('PENDING');
    });

    it('never lets a trader delete another trader’s notification', async () => {
      const owner = await makeUser();
      const stranger = await makeUser();
      const note = await prisma.notification.create({
        data: { userId: owner.id, kind: 'SYSTEM', title: 'Not yours', body: 'Private to owner' },
      });

      const res = await request(app)
        .delete(`/api/me/notifications/${note.id}`)
        .set('Authorization', authed(stranger));
      expect(res.status).toBe(404);

      const untouched = await prisma.notification.findUniqueOrThrow({ where: { id: note.id } });
      expect(untouched.readAt).toBeNull();
    });
  });
});
