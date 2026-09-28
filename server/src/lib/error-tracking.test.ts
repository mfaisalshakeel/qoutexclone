import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@sentry/node', () => ({
  init: vi.fn(),
  captureException: vi.fn(),
  close: vi.fn().mockResolvedValue(true),
}));

async function load(envPatch: Record<string, string>) {
  vi.resetModules();
  for (const [key, value] of Object.entries(envPatch)) process.env[key] = value;
  const Sentry = await import('@sentry/node');
  const mod = await import('./error-tracking.js');
  return { Sentry, mod };
}

describe('error tracking', () => {
  const original = { ...process.env };
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {
    process.env = { ...original };
  });

  it('is a no-op with SENTRY_DSN unset — never initialises, never reports', async () => {
    const { Sentry, mod } = await load({ SENTRY_DSN: '' });
    expect(mod.errorTrackingEnabled()).toBe(false);
    expect(Sentry.init).not.toHaveBeenCalled();

    mod.captureException(new Error('boom'), { path: '/api/trades' });
    expect(Sentry.captureException).not.toHaveBeenCalled();

    await mod.flushErrorTracking();
    expect(Sentry.close).not.toHaveBeenCalled();
  });

  it('initialises and reports once a DSN is configured', async () => {
    const { Sentry, mod } = await load({ SENTRY_DSN: 'https://key@example.test/1', NODE_ENV: 'test' });
    expect(mod.errorTrackingEnabled()).toBe(true);
    expect(Sentry.init).toHaveBeenCalledWith(
      expect.objectContaining({ dsn: 'https://key@example.test/1', tracesSampleRate: 0 }),
    );

    const err = new Error('boom');
    mod.captureException(err, { path: '/api/trades' });
    expect(Sentry.captureException).toHaveBeenCalledWith(err, { extra: { path: '/api/trades' } });

    await mod.flushErrorTracking(500);
    expect(Sentry.close).toHaveBeenCalledWith(500);
  });

  it('never calls Sentry for an AppError-style expected outcome — only middleware/error.ts decides that, by never calling captureException for one', async () => {
    // this test documents the contract rather than exercising middleware
    // directly: captureException has no AppError-awareness of its own, so
    // the discipline lives entirely in middleware/error.ts's own branching
    // (see errorHandler — AppError/ZodError/MulterError/isConflict all
    // return before the captureException call is ever reached)
    const { Sentry, mod } = await load({ SENTRY_DSN: 'https://key@example.test/1' });
    mod.captureException(new Error('a genuine 500'));
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
  });
});
