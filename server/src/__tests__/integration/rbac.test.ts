/**
 * Admin access control against a real database.
 *
 * `requireAdmin` and `requirePermission` both read the account fresh from the
 * database on every request rather than trusting the access token, so a role
 * change or turning 2FA off takes effect on the very next request — the part
 * worth proving here is that live check, which only exists across rows.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../../lib/errors.js';

const TEST_DB = process.env.TEST_DATABASE_URL;
if (TEST_DB) process.env.DATABASE_URL = TEST_DB;

const suite = TEST_DB ? describe : describe.skip;

suite('admin access control', () => {
  let prisma: (typeof import('../../lib/prisma.js'))['prisma'];
  let requireAdmin: (typeof import('../../middleware/auth.js'))['requireAdmin'];
  let requirePermission: (typeof import('../../middleware/auth.js'))['requirePermission'];

  const made: string[] = [];

  const makeUser = async (overrides: Record<string, unknown> = {}) => {
    const user = await prisma.user.create({
      data: {
        email: `rbac-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.dev`,
        name: 'RBAC Test',
        passwordHash: 'x',
        referralCode: Math.random().toString(36).slice(2, 10).toUpperCase(),
        ...overrides,
      },
    });
    made.push(user.id);
    return user;
  };

  /** Runs a middleware and returns what it passed to `next`, if anything. */
  const run = (
    middleware: (req: Request, res: Response, next: NextFunction) => void,
    userId: string,
    adminRole?: string | null,
  ): Promise<unknown> =>
    new Promise((resolve) => {
      const req = { user: { id: userId, role: 'ADMIN', email: 'x@test.dev', adminRole } } as unknown as Request;
      middleware(req, {} as Response, (err?: unknown) => resolve(err));
    });

  beforeAll(async () => {
    prisma = (await import('../../lib/prisma.js')).prisma;
    ({ requireAdmin, requirePermission } = await import('../../middleware/auth.js'));
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.user.deleteMany({ where: { id: { in: made } } });
    await prisma.$disconnect();
  });

  describe('requireAdmin', () => {
    it('refuses a trader account, admin role or not', async () => {
      const trader = await makeUser({ role: 'USER' });
      const err = (await run(requireAdmin, trader.id)) as AppError;
      expect(err).toBeInstanceOf(AppError);
      expect(err.status).toBe(403);
      expect(err.code).toBe('forbidden');
    });

    it('refuses staff with no second factor enrolled', async () => {
      const staff = await makeUser({ role: 'ADMIN', adminRole: 'SUPPORT' });
      const err = (await run(requireAdmin, staff.id)) as AppError;
      expect(err).toBeInstanceOf(AppError);
      expect(err.code).toBe('admin_2fa_required');
    });

    it('admits staff with 2FA on, and stamps the role onto req.user', async () => {
      const staff = await makeUser({
        role: 'ADMIN',
        adminRole: 'FINANCE',
        twoFactorSecret: 'JBSWY3DPEHPK3PXP',
        twoFactorEnabledAt: new Date(),
      });
      const req = { user: { id: staff.id, role: 'ADMIN', email: staff.email } } as unknown as Request;
      const err = await new Promise((resolve) => {
        requireAdmin(req, {} as Response, (e?: unknown) => resolve(e));
      });
      expect(err).toBeUndefined();
      expect(req.user!.adminRole).toBe('FINANCE');
    });

    it("takes effect immediately when 2FA is turned back off, not at the token's expiry", async () => {
      const staff = await makeUser({
        role: 'ADMIN',
        adminRole: 'RISK',
        twoFactorSecret: 'JBSWY3DPEHPK3PXP',
        twoFactorEnabledAt: new Date(),
      });
      expect(await run(requireAdmin, staff.id)).toBeUndefined();

      await prisma.user.update({ where: { id: staff.id }, data: { twoFactorEnabledAt: null } });
      const err = (await run(requireAdmin, staff.id)) as AppError;
      expect(err.code).toBe('admin_2fa_required');
    });
  });

  describe('requirePermission', () => {
    it('lets a role through for an area it holds, and blocks one it does not', async () => {
      const okErr = await run(requirePermission('finance'), 'unused-id', 'FINANCE');
      expect(okErr).toBeUndefined();

      const blockedErr = (await run(requirePermission('finance'), 'unused-id', 'RISK')) as AppError;
      expect(blockedErr).toBeInstanceOf(AppError);
      expect(blockedErr.status).toBe(403);
      expect(blockedErr.code).toBe('insufficient_permission');
    });

    it('lets the super admin through everything', async () => {
      for (const area of ['finance', 'risk', 'support', 'content', 'settings'] as const) {
        expect(await run(requirePermission(area), 'unused-id', 'SUPER_ADMIN')).toBeUndefined();
      }
    });

    it('refuses a request with no adminRole at all', async () => {
      const err = (await run(requirePermission('dashboard'), 'unused-id', null)) as AppError;
      expect(err).toBeInstanceOf(AppError);
      expect(err.code).toBe('insufficient_permission');
    });
  });
});
