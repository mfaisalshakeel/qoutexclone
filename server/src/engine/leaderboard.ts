/**
 * Today's top traders.
 *
 * A leaderboard is published to strangers, so it never carries a trader's full
 * name or anything else that identifies them. What it shows is enough for
 * someone to recognise their own row and nothing more: an initial, a masked
 * name, and a country.
 *
 * Pure, so what is published can be reasoned about in a test rather than
 * discovered in production.
 */

export interface LeaderboardInput {
  userId: string;
  name: string;
  country?: string | null;
  /** Net profit today, in cents. */
  profit: number;
  trades: number;
  wins: number;
}

export interface LeaderboardRow {
  rank: number;
  /** A masked name — never the real one. */
  display: string;
  country: string | null;
  flag: string | null;
  profit: number;
  trades: number;
  /** Whole percentage of positions won. */
  winRate: number;
  /** True for the row belonging to whoever is reading. */
  isYou: boolean;
}

/**
 * Masks a name to an initial and a shape.
 *
 * "Muhammad Faisal" becomes "M••••••• F." — the owner recognises it, a stranger
 * learns almost nothing, and two traders with similar names stay distinct
 * enough to be different rows.
 */
export function maskName(name: string): string {
  const cleaned = name.trim().replace(/\s+/g, ' ');
  if (!cleaned) return 'Trader';

  const [first, ...rest] = cleaned.split(' ');
  const head = `${first[0].toUpperCase()}${'•'.repeat(Math.min(Math.max(first.length - 1, 1), 8))}`;
  const surname = rest.at(-1);
  return surname ? `${head} ${surname[0].toUpperCase()}.` : head;
}

/**
 * A flag for a two-letter country code, built from regional indicators.
 *
 * Anything that is not a plain two-letter code returns null rather than a
 * mystery glyph — a leaderboard row with a broken character in it looks like a
 * bug, which is worse than no flag.
 */
export function flagFor(country?: string | null): string | null {
  if (!country) return null;
  const code = country.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return null;
  return String.fromCodePoint(...[...code].map((letter) => 0x1f1e6 + letter.charCodeAt(0) - 65));
}

/**
 * Ranks the day's traders, highest profit first.
 *
 * Ties are broken by how few positions it took, then by id, so the order is
 * stable between refreshes — a leaderboard that reshuffles identical rows on
 * every poll looks broken.
 */
export function rank(
  entries: LeaderboardInput[],
  options: { viewerId?: string; limit?: number } = {},
): LeaderboardRow[] {
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);

  return [...entries]
    .sort((a, b) => b.profit - a.profit || a.trades - b.trades || a.userId.localeCompare(b.userId))
    .slice(0, limit)
    .map((entry, index) => ({
      rank: index + 1,
      display: maskName(entry.name),
      country: entry.country?.trim() || null,
      flag: flagFor(entry.country),
      profit: entry.profit,
      trades: entry.trades,
      winRate: entry.trades > 0 ? Math.round((entry.wins / entry.trades) * 100) : 0,
      isYou: !!options.viewerId && entry.userId === options.viewerId,
    }));
}
