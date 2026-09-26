/**
 * `requireNotInMaintenance`: the one auth gate that reads only runtime
 * settings, no database, so it is worth a plain unit test rather than an
 * integration one.
 */
import type { NextFunction, Request, Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { requireNotInMaintenance } from './auth.js';
import { settings } from '../services/settings.js';
import { AppError } from '../lib/errors.js';

const run = (req: Partial<Request>): Promise<unknown> =>
  new Promise((resolve) => {
    requireNotInMaintenance(req as Request, {} as Response, ((err?: unknown) => resolve(err)) as NextFunction);
  });

describe('requireNotInMaintenance', () => {
  afterEach(() => vi.restoreAllMocks());

  it('lets everyone through while maintenance mode is off', async () => {
    vi.spyOn(settings, 'get').mockImplementation((key) => (key === 'general.maintenanceMode' ? false : undefined) as never);
    const err = await run({ user: { id: '1', role: 'USER', email: 'a@b.com' }, ip: '1.2.3.4' });
    expect(err).toBeUndefined();
  });

  it('blocks a trader once maintenance mode is on', async () => {
    vi.spyOn(settings, 'get').mockImplementation(((key: string) => {
      if (key === 'general.maintenanceMode') return true;
      if (key === 'general.maintenanceAllowlist') return [];
      if (key === 'general.maintenanceMessage') return 'Back soon.';
      return undefined;
    }) as never);
    const err = (await run({ user: { id: '1', role: 'USER', email: 'a@b.com' }, ip: '1.2.3.4' })) as AppError;
    expect(err).toBeInstanceOf(AppError);
    expect(err.status).toBe(503);
    expect(err.code).toBe('maintenance');
    expect(err.message).toBe('Back soon.');
  });

  it('never blocks an admin', async () => {
    vi.spyOn(settings, 'get').mockImplementation(((key: string) => {
      if (key === 'general.maintenanceMode') return true;
      if (key === 'general.maintenanceAllowlist') return [];
      return undefined;
    }) as never);
    const err = await run({ user: { id: '1', role: 'ADMIN', email: 'a@b.com' }, ip: '1.2.3.4' });
    expect(err).toBeUndefined();
  });

  it('lets an allowlisted IP through even though it has no account', async () => {
    vi.spyOn(settings, 'get').mockImplementation(((key: string) => {
      if (key === 'general.maintenanceMode') return true;
      if (key === 'general.maintenanceAllowlist') return ['203.0.113.9'];
      return undefined;
    }) as never);
    const err = await run({ ip: '203.0.113.9' });
    expect(err).toBeUndefined();
  });

  it('still blocks an IP that is not on the list', async () => {
    vi.spyOn(settings, 'get').mockImplementation(((key: string) => {
      if (key === 'general.maintenanceMode') return true;
      if (key === 'general.maintenanceAllowlist') return ['203.0.113.9'];
      if (key === 'general.maintenanceMessage') return 'Back soon.';
      return undefined;
    }) as never);
    const err = (await run({ ip: '203.0.113.10' })) as AppError;
    expect(err).toBeInstanceOf(AppError);
    expect(err.status).toBe(503);
  });
});
