import { describe, expect, it } from 'vitest';
import { priorityOrder, quoteWithdrawal } from '../services/withdrawals.js';
import { env } from '../env.js';

describe('withdrawal quotes', () => {
  it('charges the flat network fee plus the platform percentage', () => {
    const quote = quoteWithdrawal('USDT', 'TRC20', 10000); // $100
    // TRC-20 network fee $1 + platform flat $1 + 1% of $100
    expect(quote.fee).toBe(300);
    expect(quote.netAmount).toBe(9700);
    expect(quote.cryptoAmount).toBe('97.000000');
  });

  it('scales the percentage part with the amount', () => {
    const small = quoteWithdrawal('USDT', 'TRC20', 5000);
    const large = quoteWithdrawal('USDT', 'TRC20', 100000);
    expect(large.fee - small.fee).toBe(Math.round(((100000 - 5000) * env.withdrawFeePct) / 100));
  });

  it('applies each network its own minimum and fee', () => {
    const btc = quoteWithdrawal('BTC', 'BITCOIN', 10000);
    const trc = quoteWithdrawal('USDT', 'TRC20', 10000);
    expect(btc.fee).toBeGreaterThan(trc.fee);
    expect(btc.minAmount).toBe(3000); // $30 minimum on Bitcoin
    expect(trc.minAmount).toBe(Math.max(1000, env.minWithdrawUsd * 100));
  });

  it('converts the net amount at the live rate with network precision', () => {
    const quote = quoteWithdrawal('BTC', 'BITCOIN', 100000);
    expect(quote.cryptoAmount.split('.')[1]).toHaveLength(8);
    expect(Number(quote.cryptoAmount) * quote.rate * 100).toBeCloseTo(quote.netAmount, 0);
  });

  it('reports a non-positive net when the amount cannot cover the fee', () => {
    expect(quoteWithdrawal('BTC', 'BITCOIN', 100).netAmount).toBeLessThanOrEqual(0);
  });

  it('refuses an unsupported currency/network pair', () => {
    expect(() => quoteWithdrawal('USDT', 'BITCOIN', 10000)).toThrow(/Unsupported/);
  });
});

describe('priorityOrder', () => {
  // the default status thresholds: $0 = Standard, $1,000 = Pro, $10,000 = VIP
  const row = (id: string, totalDeposited: number, createdAt: string) => ({
    id,
    createdAt: new Date(createdAt),
    user: { totalDeposited },
  });

  it('serves a higher status level first, whatever the request order', () => {
    const rows = [
      row('standard', 0, '2026-01-01T00:00:00Z'),
      row('vip', 1_000_000, '2026-01-03T00:00:00Z'),
      row('pro', 100_000, '2026-01-02T00:00:00Z'),
    ];
    expect(priorityOrder(rows).map((r) => r.id)).toEqual(['vip', 'pro', 'standard']);
  });

  it('serves the oldest request first within the same level', () => {
    const rows = [
      row('newer', 100_000, '2026-01-05T00:00:00Z'),
      row('oldest', 100_000, '2026-01-01T00:00:00Z'),
      row('middle', 100_000, '2026-01-03T00:00:00Z'),
    ];
    expect(priorityOrder(rows).map((r) => r.id)).toEqual(['oldest', 'middle', 'newer']);
  });

  it('attaches the level it computed to each row', () => {
    const [vip] = priorityOrder([row('vip', 1_000_000, '2026-01-01T00:00:00Z')]);
    expect(vip.level.id).toBe('VIP');
    expect(vip.level.priority).toBeGreaterThan(0);
  });

  it('does not mutate the input array', () => {
    const rows = [row('a', 0, '2026-01-02T00:00:00Z'), row('b', 1_000_000, '2026-01-01T00:00:00Z')];
    const original = rows.map((r) => r.id);
    priorityOrder(rows);
    expect(rows.map((r) => r.id)).toEqual(original);
  });
});
