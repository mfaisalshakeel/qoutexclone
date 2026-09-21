import { describe, expect, it } from 'vitest';
import type { PaymentMethod } from '@prisma/client';
import { assertMethodAvailable, assertWithinLimits, feeFor, isOfferedIn } from './payments.js';

function method(overrides: Partial<PaymentMethod> = {}): PaymentMethod {
  return {
    id: 'm1',
    provider: 'CRYPTO',
    key: 'crypto-usdt-trc20',
    label: 'Tether (TRC-20)',
    currency: 'USDT',
    network: 'TRC20',
    enabled: true,
    feePct: 0,
    feeFlatCents: 0,
    minDepositCents: 1_000,
    maxDepositCents: 0,
    minWithdrawCents: 3_000,
    maxWithdrawCents: 0,
    countries: null,
    sortOrder: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as PaymentMethod;
}

describe('isOfferedIn', () => {
  it('offers everywhere when the country list is empty', () => {
    expect(isOfferedIn(method(), 'US')).toBe(true);
    expect(isOfferedIn(method(), null)).toBe(true);
  });

  it('restricts to the listed countries, case-insensitively', () => {
    const restricted = method({ countries: ['US', 'GB'] });
    expect(isOfferedIn(restricted, 'US')).toBe(true);
    expect(isOfferedIn(restricted, 'gb')).toBe(true);
    expect(isOfferedIn(restricted, 'FR')).toBe(false);
  });

  it('does not refuse an unknown country against a restricted list', () => {
    // we would rather show a method than wrongly hide it from someone whose
    // country we could not determine
    expect(isOfferedIn(method({ countries: ['US'] }), null)).toBe(true);
  });
});

describe('assertMethodAvailable', () => {
  it('refuses a disabled method', () => {
    expect(() => assertMethodAvailable(method({ enabled: false }))).toThrow('not available');
  });

  it('refuses a method not offered in the trader’s country', () => {
    expect(() => assertMethodAvailable(method({ countries: ['US'] }), 'FR')).toThrow('not offered');
  });

  it('allows an enabled method offered everywhere', () => {
    expect(() => assertMethodAvailable(method())).not.toThrow();
  });
});

describe('feeFor', () => {
  it('is zero on a free method', () => {
    expect(feeFor(method(), 10_000)).toEqual({ fee: 0, net: 10_000 });
  });

  it('combines a flat fee and a percentage', () => {
    const priced = method({ feeFlatCents: 300, feePct: 2 });
    expect(feeFor(priced, 10_000)).toEqual({ fee: 500, net: 9_500 });
  });

  it('never lets the net amount go negative', () => {
    const priced = method({ feeFlatCents: 50_000 });
    expect(feeFor(priced, 1_000).net).toBe(0);
  });
});

describe('assertWithinLimits', () => {
  it('refuses below the minimum, on the right side', () => {
    expect(() => assertWithinLimits(method(), 500, 'deposit')).toThrow('Minimum deposit');
    expect(() => assertWithinLimits(method(), 2_000, 'withdraw')).toThrow('Minimum withdraw');
  });

  it('treats a maximum of zero as no cap', () => {
    expect(() => assertWithinLimits(method(), 10_000_000, 'deposit')).not.toThrow();
  });

  it('refuses above a real maximum', () => {
    expect(() => assertWithinLimits(method({ maxDepositCents: 50_000 }), 60_000, 'deposit')).toThrow(
      'Maximum deposit',
    );
  });

  it('applies exactly on the boundary', () => {
    expect(() => assertWithinLimits(method(), 1_000, 'deposit')).not.toThrow();
  });
});
