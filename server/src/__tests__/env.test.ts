import { describe, expect, it } from 'vitest';
import { validateEnv } from '../env.js';

const base = { DATABASE_URL: 'mysql://user:pass@127.0.0.1:3306/quotex' };

describe('env validation', () => {
  it('accepts a minimal environment and applies defaults', () => {
    const result = validateEnv(base);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.PORT).toBe(4000);
    expect(result.data.FEED_PROVIDER).toBe('simulated');
    expect(result.data.SETTLEMENT_INTERVAL_MS).toBe(200);
    expect(result.data.MOCK_CHAIN_WATCHER).toBe(true);
  });

  it('requires a mysql connection string', () => {
    expect(validateEnv({}).success).toBe(false);
    const wrong = validateEnv({ DATABASE_URL: 'postgres://localhost/db' });
    expect(wrong.success).toBe(false);
    if (wrong.success) return;
    expect(wrong.error.issues[0].message).toMatch(/mysql/);
  });

  it('reports every problem at once', () => {
    const result = validateEnv({ ...base, PORT: '0', FEED_PROVIDER: 'nasdaq', LOG_LEVEL: 'chatty' });
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = result.error.issues.map((issue) => issue.path.join('.'));
    expect(paths).toContain('PORT');
    expect(paths).toContain('FEED_PROVIDER');
    expect(paths).toContain('LOG_LEVEL');
  });

  it('rejects out-of-range numbers instead of silently falling back', () => {
    expect(validateEnv({ ...base, WITHDRAW_FEE_PCT: '250' }).success).toBe(false);
    expect(validateEnv({ ...base, FEED_TICK_MS: '5' }).success).toBe(false);
    expect(validateEnv({ ...base, REFRESH_TOKEN_DAYS: '9999' }).success).toBe(false);
  });

  it('parses booleans from the usual spellings', () => {
    for (const [value, expected] of [
      ['true', true],
      ['1', true],
      ['YES', true],
      ['on', true],
      ['false', false],
      ['0', false],
      ['nope', false],
    ] as const) {
      const result = validateEnv({ ...base, AUTO_APPROVE_WITHDRAWALS: value });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.AUTO_APPROVE_WITHDRAWALS).toBe(expected);
    }
  });

  it('keeps an empty string as the default rather than NaN', () => {
    const result = validateEnv({ ...base, PORT: '', MIN_DEPOSIT_USD: '' });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.PORT).toBe(4000);
    expect(result.data.MIN_DEPOSIT_USD).toBe(10);
  });
});
