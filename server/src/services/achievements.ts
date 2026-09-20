/**
 * Achievements.
 *
 * Every badge is a target against one number the platform already keeps, so a
 * new one is a row in this table and nothing else — no new counters, no
 * backfill, and progress that is correct the moment it is added rather than
 * from the day it shipped.
 */

export type AchievementMetric =
  | 'trades'
  | 'wins'
  | 'volume'
  | 'bestStreak'
  | 'netProfit'
  | 'hasDeposited'
  | 'tournaments'
  | 'markets'
  | 'emailVerified'
  | 'twoFactor';

export interface AchievementDefinition {
  key: string;
  name: string;
  description: string;
  metric: AchievementMetric;
  /** What the metric has to reach. Cents where the metric is money. */
  target: number;
  /** Grouped in the UI so a tiered set reads as one row. */
  group: string;
}

/** The numbers every achievement is measured against. */
export interface AchievementStats {
  trades: number;
  wins: number;
  /** Staked, in cents. */
  volume: number;
  bestStreak: number;
  /** Net profit on settled positions, in cents. Can be negative. */
  netProfit: number;
  totalDeposited: number;
  tournaments: number;
  /** Distinct markets traded. */
  markets: number;
  emailVerified: boolean;
  twoFactor: boolean;
}

export const ACHIEVEMENTS: AchievementDefinition[] = [
  {
    key: 'first-trade',
    name: 'Off the mark',
    description: 'Settle your first position.',
    metric: 'trades',
    target: 1,
    group: 'Positions',
  },
  {
    key: 'trades-50',
    name: 'Getting the hang of it',
    description: 'Settle 50 positions.',
    metric: 'trades',
    target: 50,
    group: 'Positions',
  },
  {
    key: 'trades-500',
    name: 'Seasoned',
    description: 'Settle 500 positions.',
    metric: 'trades',
    target: 500,
    group: 'Positions',
  },
  {
    key: 'wins-10',
    name: 'On the board',
    description: 'Win 10 positions.',
    metric: 'wins',
    target: 10,
    group: 'Wins',
  },
  {
    key: 'wins-100',
    name: 'Reliable',
    description: 'Win 100 positions.',
    metric: 'wins',
    target: 100,
    group: 'Wins',
  },
  {
    key: 'streak-5',
    name: 'Five in a row',
    description: 'Win five positions one after another.',
    metric: 'bestStreak',
    target: 5,
    group: 'Wins',
  },
  {
    key: 'streak-10',
    name: 'Ten in a row',
    description: 'Win ten positions one after another.',
    metric: 'bestStreak',
    target: 10,
    group: 'Wins',
  },
  {
    key: 'volume-1k',
    name: 'A thousand staked',
    description: 'Stake $1,000 in total.',
    metric: 'volume',
    target: 100_000,
    group: 'Volume',
  },
  {
    key: 'volume-25k',
    name: 'Twenty-five thousand staked',
    description: 'Stake $25,000 in total.',
    metric: 'volume',
    target: 2_500_000,
    group: 'Volume',
  },
  {
    key: 'profit-100',
    name: 'In the black',
    description: 'Reach $100 of net profit on settled positions.',
    metric: 'netProfit',
    target: 10_000,
    group: 'Results',
  },
  {
    key: 'markets-10',
    name: 'Well travelled',
    description: 'Trade ten different markets.',
    metric: 'markets',
    target: 10,
    group: 'Results',
  },
  {
    key: 'tournament-1',
    name: 'Entered the ring',
    description: 'Join a tournament.',
    metric: 'tournaments',
    target: 1,
    group: 'Tournaments',
  },
  {
    key: 'tournament-5',
    name: 'Regular contender',
    description: 'Join five tournaments.',
    metric: 'tournaments',
    target: 5,
    group: 'Tournaments',
  },
  {
    key: 'deposit-first',
    name: 'Funded',
    description: 'Make your first deposit.',
    metric: 'hasDeposited',
    target: 1,
    group: 'Account',
  },
  {
    key: 'email-verified',
    name: 'Address confirmed',
    description: 'Confirm your email address.',
    metric: 'emailVerified',
    target: 1,
    group: 'Account',
  },
  {
    key: 'two-factor',
    name: 'Locked down',
    description: 'Turn on two-factor authentication.',
    metric: 'twoFactor',
    target: 1,
    group: 'Account',
  },
];

export interface AchievementProgress extends AchievementDefinition {
  /** Where the trader is against the target, never above it. */
  progress: number;
  unlocked: boolean;
  percent: number;
}

function valueOf(stats: AchievementStats, metric: AchievementMetric): number {
  switch (metric) {
    case 'emailVerified':
      return stats.emailVerified ? 1 : 0;
    case 'hasDeposited':
      return stats.totalDeposited > 0 ? 1 : 0;
    case 'twoFactor':
      return stats.twoFactor ? 1 : 0;
    case 'netProfit':
      // a loss is not negative progress towards a profit badge, it is none
      return Math.max(stats.netProfit, 0);
    default:
      return stats[metric as 'trades' | 'wins' | 'volume' | 'bestStreak' | 'tournaments' | 'markets'];
  }
}

/** Every achievement with this trader's progress against it. */
export function evaluate(stats: AchievementStats): AchievementProgress[] {
  return ACHIEVEMENTS.map((definition) => {
    const value = valueOf(stats, definition.metric);
    const progress = Math.min(value, definition.target);
    return {
      ...definition,
      progress,
      unlocked: value >= definition.target,
      percent: Math.min(Math.round((value / definition.target) * 100), 100),
    };
  });
}

/** The keys a trader has earned, for writing the unlock rows. */
export function unlockedKeys(stats: AchievementStats): string[] {
  return evaluate(stats)
    .filter((achievement) => achievement.unlocked)
    .map((achievement) => achievement.key);
}
