/**
 * What the crowd is doing on a market.
 *
 * The share of staked money on UP against DOWN over a recent window, from the
 * platform's own positions. This is a *display*: nothing here feeds the price
 * engine, the payout engine or an outcome. The hard rule in CLAUDE.md is that a
 * quote never depends on what traders hold, and showing traders an aggregate of
 * their own activity does not change that — but the dependency only runs one
 * way, and it must stay that way.
 *
 * Pure, so the figures a trader reads and the figures a test asserts are the
 * same arithmetic.
 */

export interface SentimentTotals {
  upStake: number;
  downStake: number;
  upCount: number;
  downCount: number;
}

export interface Sentiment {
  /** Whole percentages that always add to 100 once there is enough activity. */
  upPct: number;
  downPct: number;
  /** Positions counted, so the reader can judge how much to trust it. */
  trades: number;
  /** Total staked in the window, in cents. */
  stake: number;
  /**
   * False when too few positions have been taken to say anything. A 100/0 split
   * from a single trade is noise dressed as information.
   */
  meaningful: boolean;
}

export const EMPTY_SENTIMENT: Sentiment = {
  upPct: 50,
  downPct: 50,
  trades: 0,
  stake: 0,
  meaningful: false,
};

/**
 * Turns raw sums into the split to show.
 *
 * Rounding is done once and the remainder given to the larger side, so the two
 * numbers always add to 100 — a bar labelled 49/50 undermines everything else
 * on the screen.
 */
export function sentimentFrom(totals: SentimentTotals, minTrades: number): Sentiment {
  const upStake = Math.max(totals.upStake, 0);
  const downStake = Math.max(totals.downStake, 0);
  const stake = upStake + downStake;
  const trades = Math.max(totals.upCount, 0) + Math.max(totals.downCount, 0);
  const meaningful = trades >= Math.max(minTrades, 1) && stake > 0;

  if (!meaningful) return { ...EMPTY_SENTIMENT, trades, stake };

  const upPct = Math.round((upStake / stake) * 100);
  return { upPct, downPct: 100 - upPct, trades, stake, meaningful: true };
}
