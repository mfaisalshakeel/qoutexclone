import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { EMPTY_SENTIMENT, sentimentFrom } from '../engine/sentiment.js';

const totals = (up: number, down: number, upCount = 5, downCount = 5) => ({
  upStake: up,
  downStake: down,
  upCount,
  downCount,
});

describe('sentiment is a display, not an input', () => {
  it('cannot reach a price, a payout or an outcome', () => {
    // the dependency runs one way only: positions → display, never back
    const source = fs.readFileSync(path.join(process.cwd(), 'src/engine/sentiment.ts'), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/\bimport\b/);
    for (const forbidden of ['price', 'payout', 'feed', 'tick', 'settle', 'outcome']) {
      expect(code.toLowerCase(), `mentions ${forbidden}`).not.toContain(forbidden);
    }
  });
});

describe('the split', () => {
  it('is the share of staked money, not of trade count', () => {
    // one big UP against four small DOWNs is a bullish book, and says so
    const result = sentimentFrom(totals(80_000, 20_000, 1, 4), 5);
    expect(result.upPct).toBe(80);
    expect(result.downPct).toBe(20);
    expect(result.trades).toBe(5);
  });

  it('always adds to 100', () => {
    for (const [up, down] of [
      [1, 2],
      [33_333, 66_667],
      [1, 0],
      [7, 7],
      [999_999, 1],
    ]) {
      const result = sentimentFrom(totals(up, down), 1);
      expect(result.upPct + result.downPct, `${up}/${down}`).toBe(100);
    }
  });

  it('gives the remainder to the larger side rather than showing 49/50', () => {
    const result = sentimentFrom(totals(1, 2), 1);
    expect(result.upPct).toBe(33);
    expect(result.downPct).toBe(67);
  });

  it('reports the totals so a reader can judge it', () => {
    const result = sentimentFrom(totals(60_000, 40_000, 3, 2), 5);
    expect(result.stake).toBe(100_000);
    expect(result.trades).toBe(5);
  });
});

describe('too little activity', () => {
  it('says nothing rather than dressing up one trade as a trend', () => {
    const result = sentimentFrom(totals(10_000, 0, 1, 0), 5);
    expect(result.meaningful).toBe(false);
    expect(result.upPct).toBe(50);
    expect(result.downPct).toBe(50);
    // the counts are still reported, so the UI can say how close it is
    expect(result.trades).toBe(1);
    expect(result.stake).toBe(10_000);
  });

  it('is empty with no activity at all', () => {
    expect(sentimentFrom(totals(0, 0, 0, 0), 5)).toEqual(EMPTY_SENTIMENT);
  });

  it('needs at least one trade however low the threshold is set', () => {
    expect(sentimentFrom(totals(0, 0, 0, 0), 0).meaningful).toBe(false);
    expect(sentimentFrom(totals(100, 0, 1, 0), 0).meaningful).toBe(true);
  });

  it('ignores stake with no positions behind it', () => {
    // a nonsense row cannot make the bar meaningful
    expect(sentimentFrom(totals(50_000, 50_000, 0, 0), 1).meaningful).toBe(false);
  });
});

describe('bad input', () => {
  it('treats negative sums as zero rather than inverting the bar', () => {
    const result = sentimentFrom(totals(-100, 50_000, 1, 4), 1);
    expect(result.upPct).toBe(0);
    expect(result.downPct).toBe(100);
  });
});
