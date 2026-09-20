/**
 * The marketplace as it ships.
 *
 * Seeded once by key and never overwritten, so an operator's edits survive a
 * re-seed. Prices are deliberately modest: the point of the shop is to give a
 * trader something to do with loyalty points, not to be a second revenue line.
 */
export const DEFAULT_MARKETPLACE_ITEMS = [
  {
    key: 'booster-5-30',
    name: 'Payout booster +5%',
    description: 'Adds five percentage points to your payout on every position for thirty minutes.',
    kind: 'PAYOUT_BOOSTER',
    priceCents: 500,
    pricePoints: 2_000,
    config: { bonusPct: 5, minutes: 30 },
    sortOrder: 10,
  },
  {
    key: 'booster-10-15',
    name: 'Payout booster +10%',
    description: 'Ten percentage points for fifteen minutes, for when you are sure.',
    priceCents: 1_000,
    pricePoints: 4_000,
    kind: 'PAYOUT_BOOSTER',
    config: { bonusPct: 10, minutes: 15 },
    sortOrder: 20,
  },
  {
    key: 'risk-free-1',
    name: 'Risk-free position',
    description: 'Your next losing position is refunded, up to $50. Valid for 24 hours.',
    kind: 'RISK_FREE',
    priceCents: 300,
    pricePoints: 1_500,
    config: { trades: 1, maxRefundCents: 5_000, hours: 24 },
    sortOrder: 30,
  },
  {
    key: 'risk-free-3',
    name: 'Risk-free three',
    description: 'The next three losing positions are refunded, up to $50 each. Valid for a week.',
    kind: 'RISK_FREE',
    priceCents: 800,
    pricePoints: 4_000,
    config: { trades: 3, maxRefundCents: 5_000, hours: 168 },
    sortOrder: 40,
  },
  {
    key: 'deposit-bonus-20',
    name: '20% deposit coupon',
    description: 'Adds 20% to your next deposit, up to $200. Valid for thirty days.',
    kind: 'DEPOSIT_BONUS',
    priceCents: 0,
    pricePoints: 5_000,
    config: { percent: 20, maxBonusCents: 20_000, days: 30 },
    sortOrder: 50,
  },
  {
    key: 'practice-refill-10k',
    name: 'Practice top-up',
    description: 'Adds $10,000 to your practice balance straight away.',
    kind: 'PRACTICE_REFILL',
    priceCents: 0,
    pricePoints: 500,
    config: { amountCents: 1_000_000 },
    sortOrder: 60,
  },
] as const;
