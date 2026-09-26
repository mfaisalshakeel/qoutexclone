import { describe, expect, it, beforeEach } from 'vitest';
import { SETTINGS, settings } from '../services/settings.js';

describe('settings registry', () => {
  beforeEach(() => settings._clear());

  it('falls back to the registry default before anything is loaded', () => {
    expect(settings.get('general.siteName')).toBe('Quantex');
    expect(settings.get('trading.durations')).toContain(60);
    expect(settings.get('wallet.withdrawFeePct')).toBeTypeOf('number');
  });

  it('every default satisfies its own schema', () => {
    for (const [key, definition] of Object.entries(SETTINGS)) {
      const parsed = definition.schema.safeParse(definition.default);
      expect(parsed.success, `${key} default is invalid`).toBe(true);
    }
  });

  it('groups and types every key for the admin UI', () => {
    const described = settings.describe();
    expect(described.length).toBe(Object.keys(SETTINGS).length);
    for (const row of described) {
      expect(['general', 'trading', 'wallet', 'growth', 'compliance', 'security']).toContain(row.group);
      expect(['boolean', 'number', 'string', 'numberList', 'stringList']).toContain(row.type);
      expect(row.label.length).toBeGreaterThan(0);
    }
  });

  it('exposes only public keys to anonymous clients', () => {
    const publicValues = settings.publicValues();
    expect(publicValues['general.siteName']).toBeDefined();
    expect(publicValues['trading.durations']).toBeDefined();
    // operational knobs stay private
    expect(publicValues['wallet.autoApproveWithdrawals']).toBeUndefined();
    expect(publicValues['security.sessionDays']).toBeUndefined();
  });

  it('rejects a value that breaks the key schema', async () => {
    await expect(settings.set('wallet.withdrawFeePct', 250)).rejects.toThrow(/Invalid value/);
    await expect(settings.set('trading.durations', ['1m'])).rejects.toThrow(/Invalid value/);
    await expect(settings.set('general.supportEmail', 'not-an-email')).rejects.toThrow(/Invalid value/);
    // and the cache is untouched by a rejected write
    expect(settings.get('wallet.withdrawFeePct')).toBe(SETTINGS['wallet.withdrawFeePct'].default);
  });

  it('refuses an unknown key', async () => {
    await expect(settings.set('nope.not.a.key' as never, 1)).rejects.toThrow();
  });

  it('types a list of strings correctly even when its default is empty', () => {
    // read off the schema, not the value — an empty default array has no
    // element to inspect, and used to fall through to "numberList"
    const row = settings.describe().find((r) => r.key === 'general.maintenanceAllowlist')!;
    expect(row.type).toBe('stringList');
    const numbers = settings.describe().find((r) => r.key === 'trading.durations')!;
    expect(numbers.type).toBe('numberList');
  });
});
