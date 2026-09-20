/**
 * The bonus offers the platform ships with.
 *
 * Seeded once by key, so an operator's edits survive a re-seed. The turnover
 * multipliers are deliberately conservative: a bonus nobody can ever release
 * is worse than no bonus, because it reads as a trick.
 */
export const DEFAULT_BONUS_OFFERS = [
  {
    key: 'welcome-30',
    name: '30% welcome bonus',
    description: 'Adds 30% to your deposit, up to $300. Stake it 15 times to release it.',
    percent: 30,
    maxBonusCents: 30_000,
    minDepositCents: 5_000,
    turnoverMultiplier: 15,
    sortOrder: 10,
  },
  {
    key: 'boost-50',
    name: '50% boost',
    description: 'Adds 50% to your deposit, up to $1,000. Stake it 25 times to release it.',
    percent: 50,
    maxBonusCents: 100_000,
    minDepositCents: 20_000,
    turnoverMultiplier: 25,
    sortOrder: 20,
  },
  {
    key: 'light-10',
    name: '10% with light turnover',
    description: 'Adds 10% to your deposit, up to $100. Stake it 5 times to release it.',
    percent: 10,
    maxBonusCents: 10_000,
    minDepositCents: 2_000,
    turnoverMultiplier: 5,
    sortOrder: 30,
  },
] as const;
