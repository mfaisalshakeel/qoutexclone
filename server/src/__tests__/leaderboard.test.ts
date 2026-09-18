import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { flagFor, maskName, rank, type LeaderboardInput } from '../engine/leaderboard.js';

const entry = (over: Partial<LeaderboardInput> & { userId: string }): LeaderboardInput => ({
  name: 'Test Trader',
  country: 'PK',
  profit: 1000,
  trades: 5,
  wins: 3,
  ...over,
});

describe('a leaderboard is published, so it carries no identity', () => {
  it('never handles an email, a password or an id beyond matching the viewer', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src/engine/leaderboard.ts'), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/\bimport\b/);
    for (const forbidden of ['email', 'password', 'phone', 'balance', 'ip']) {
      expect(code.toLowerCase(), `mentions ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('masks a name to an initial and a shape', () => {
    expect(maskName('Muhammad Faisal')).toBe('M••••••• F.');
    expect(maskName('Ada')).toBe('A••');
    expect(maskName('ada lovelace king')).toBe('A•• K.');
  });

  it('never leaks the full name, however odd the input', () => {
    for (const name of ['Bo', 'X', 'Zoë Müller', '  spaced   out  ', 'ALLCAPS NAME']) {
      const masked = maskName(name);
      expect(masked, name).not.toBe(name.trim());
      expect(masked.length, name).toBeLessThanOrEqual(14);
    }
  });

  it('falls back to a label rather than an empty row', () => {
    expect(maskName('')).toBe('Trader');
    expect(maskName('   ')).toBe('Trader');
  });

  it('caps the mask so a very long name cannot be reconstructed from its length', () => {
    expect(maskName('Bartholomewwwwwwwwwwwwwwww')).toBe('B••••••••');
  });
});

describe('flags', () => {
  it('builds one from a two-letter code', () => {
    expect(flagFor('PK')).toBe('🇵🇰');
    expect(flagFor('gb')).toBe('🇬🇧');
    expect(flagFor(' de ')).toBe('🇩🇪');
  });

  it('returns nothing rather than a mystery glyph', () => {
    for (const bad of [null, undefined, '', 'Pakistan', 'P', 'P1', '123', '🇵🇰']) {
      expect(flagFor(bad), String(bad)).toBeNull();
    }
  });
});

describe('ranking', () => {
  const entries = [
    entry({ userId: 'a', profit: 5_000, trades: 10, wins: 6 }),
    entry({ userId: 'b', profit: 9_000, trades: 4, wins: 4 }),
    entry({ userId: 'c', profit: -2_000, trades: 3, wins: 0 }),
  ];

  it('puts the highest profit first', () => {
    expect(rank(entries).map((row) => row.rank)).toEqual([1, 2, 3]);
    expect(rank(entries)[0].profit).toBe(9_000);
    expect(rank(entries).at(-1)!.profit).toBe(-2_000);
  });

  it('breaks a tie the same way every time', () => {
    const tied = [
      entry({ userId: 'z', profit: 1_000, trades: 9 }),
      entry({ userId: 'y', profit: 1_000, trades: 2 }),
      entry({ userId: 'x', profit: 1_000, trades: 2 }),
    ];
    const once = rank(tied).map((row) => row.display + row.trades);
    const twice = rank(tied).map((row) => row.display + row.trades);
    expect(once).toEqual(twice);
    // fewer positions for the same profit ranks higher, then id decides
    expect(rank(tied)[0].trades).toBe(2);
  });

  it('computes a win rate and marks the viewer', () => {
    const rows = rank(entries, { viewerId: 'a' });
    const mine = rows.find((row) => row.isYou)!;
    expect(mine.winRate).toBe(60);
    expect(rows.filter((row) => row.isYou)).toHaveLength(1);
  });

  it('marks nobody when there is no viewer', () => {
    expect(rank(entries).some((row) => row.isYou)).toBe(false);
  });

  it('honours the limit and its bounds', () => {
    expect(rank(entries, { limit: 2 })).toHaveLength(2);
    expect(rank(entries, { limit: 0 })).toHaveLength(1);
    expect(rank(entries, { limit: 1000 })).toHaveLength(3);
  });

  it('does not reorder the array it was given', () => {
    const original = [...entries];
    rank(entries);
    expect(entries).toEqual(original);
  });

  it('handles a trader with no settled positions', () => {
    const rows = rank([entry({ userId: 'n', trades: 0, wins: 0, profit: 0 })]);
    expect(rows[0].winRate).toBe(0);
  });
});
