import { describe, expect, it } from 'vitest';
import { MARKETS, MARKET_COUNTS } from '../data/markets.js';

describe('market catalogue', () => {
  it('meets the coverage the product needs', () => {
    // 20+ currency pairs, 12 crypto, gold/silver/oil, 10 stocks, 5 indices
    const nonOtc = MARKETS.filter((market) => !market.isOtc);
    expect(nonOtc.filter((m) => m.assetClass === 'CURRENCY').length).toBeGreaterThanOrEqual(20);
    expect(nonOtc.filter((m) => m.assetClass === 'CRYPTO').length).toBe(12);
    expect(nonOtc.filter((m) => m.assetClass === 'COMMODITY').length).toBe(3);
    expect(nonOtc.filter((m) => m.assetClass === 'STOCK').length).toBe(10);
    expect(nonOtc.filter((m) => m.assetClass === 'INDEX').length).toBe(5);
  });

  it('gives every currency pair an OTC twin', () => {
    const currencies = MARKETS.filter((m) => m.assetClass === 'CURRENCY' && !m.isOtc);
    for (const market of currencies) {
      const twin = MARKETS.find((candidate) => candidate.symbol === `${market.symbol}_OTC`);
      expect(twin, `${market.symbol} has no OTC variant`).toBeDefined();
      expect(twin!.isOtc).toBe(true);
    }
    // and a selection of the other classes
    for (const symbol of [
      'BTCUSDT_OTC',
      'ETHUSDT_OTC',
      'XAUUSD_OTC',
      'XAGUSD_OTC',
      'USOUSD_OTC',
      'US500_OTC',
    ]) {
      expect(
        MARKETS.some((m) => m.symbol === symbol),
        `${symbol} missing`,
      ).toBe(true);
    }
  });

  it('uses unique symbols', () => {
    const symbols = MARKETS.map((market) => market.symbol);
    expect(new Set(symbols).size).toBe(symbols.length);
  });

  it('keeps pip size consistent with precision', () => {
    for (const market of MARKETS) {
      expect(market.pipSize, market.symbol).toBeCloseTo(10 ** -market.precision, 10);
      expect(market.precision).toBeGreaterThanOrEqual(2);
      expect(market.precision).toBeLessThanOrEqual(6);
    }
  });

  it('quotes sane prices, payouts and volatility', () => {
    for (const market of MARKETS) {
      expect(market.basePrice, market.symbol).toBeGreaterThan(0);
      expect(market.payoutPct).toBeGreaterThanOrEqual(60);
      expect(market.payoutPct).toBeLessThanOrEqual(95);
      // per-minute sigma: anything above 1% a minute would be nonsense
      expect(market.volatility).toBeGreaterThan(0);
      expect(market.volatility).toBeLessThan(0.01);
      expect(market.icon.length).toBeGreaterThan(0);
      expect(market.pair).toMatch(/\S/);
    }
  });

  it('prices OTC twins a little richer and marks them clearly', () => {
    for (const otc of MARKETS.filter((market) => market.isOtc)) {
      const spot = MARKETS.find((market) => market.symbol === otc.symbol.replace('_OTC', ''))!;
      expect(otc.payoutPct).toBeGreaterThanOrEqual(spot.payoutPct);
      expect(otc.payoutPct).toBeLessThanOrEqual(95);
      expect(otc.volatility).toBeGreaterThan(spot.volatility);
      expect(otc.name).toMatch(/\(OTC\)$/);
      expect(otc.pair).toMatch(/\(OTC\)$/);
      // broker-priced markets must not point at an exchange symbol
      expect(otc.feedSymbol).toBe(otc.symbol);
    }
  });

  it('reports its own composition', () => {
    expect(MARKET_COUNTS.total).toBe(MARKETS.length);
    expect(MARKET_COUNTS.otc).toBe(MARKETS.filter((m) => m.isOtc).length);
    expect(Object.keys(MARKET_COUNTS.byClass).sort()).toEqual([
      'COMMODITY',
      'CRYPTO',
      'CURRENCY',
      'INDEX',
      'STOCK',
    ]);
  });
});
