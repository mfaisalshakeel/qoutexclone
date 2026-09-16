/**
 * All fiat balances are integer cents. Crypto amounts are decimal strings so
 * they never pass through a float on the way to (or from) a chain payload.
 */
export const CENTS = 100;

export function usdToCents(usd: number): number {
  return Math.round(usd * CENTS);
}

export function centsToUsd(cents: number): number {
  return cents / CENTS;
}

export function formatUsd(cents: number): string {
  return (cents / CENTS).toFixed(2);
}

/** Profit for a winning binary option, rounded down to the cent. */
export function winProfit(stakeCents: number, payoutPct: number): number {
  return Math.floor((stakeCents * payoutPct) / 100);
}

/** Crypto units for a USD cent amount at `rate` USD/unit, truncated to `decimals`. */
export function centsToCrypto(cents: number, rate: number, decimals = 8): string {
  if (!(rate > 0)) throw new Error('rate must be positive');
  const units = cents / CENTS / rate;
  const factor = 10 ** decimals;
  return (Math.floor(units * factor) / factor).toFixed(decimals);
}

/** USD cents for a crypto amount at `rate` USD/unit, rounded to the cent. */
export function cryptoToCents(amount: string | number, rate: number): number {
  const units = typeof amount === 'string' ? Number(amount) : amount;
  if (!Number.isFinite(units) || units < 0) throw new Error('invalid crypto amount');
  return Math.round(units * rate * CENTS);
}
