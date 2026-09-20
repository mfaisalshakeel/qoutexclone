import { settings } from './settings.js';

/**
 * Status levels.
 *
 * Three of them, reached by lifetime deposits, each with perks an operator
 * configures: a payout bonus on the trader's own positions, a percentage added
 * to their deposits, and a place in the withdrawal queue.
 *
 * The maths here is pure and takes its numbers as arguments, so the rules can
 * be tested without a database and the same function answers "what level is
 * this trader" and "what would they get at the next one".
 */

export type StatusLevelId = 'STANDARD' | 'PRO' | 'VIP';

export interface StatusLevel {
  id: StatusLevelId;
  name: string;
  /** Lifetime deposits needed, in cents. */
  threshold: number;
  /** Percentage points added to this trader's quoted payout. */
  payoutBonus: number;
  /** Percentage added to each deposit. */
  depositBonus: number;
  /** Higher is served first in the withdrawal queue. */
  priority: number;
}

export interface StatusConfig {
  enabled: boolean;
  levels: StatusLevel[];
  /** A payout can never be raised above this by a status bonus. */
  maxPayoutPct: number;
}

/** The levels as an operator has configured them, lowest first. */
export function statusConfig(): StatusConfig {
  return {
    enabled: settings.get('growth.statusEnabled'),
    maxPayoutPct: settings.get('growth.statusMaxPayoutPct'),
    levels: [
      {
        id: 'STANDARD',
        name: settings.get('growth.statusStandardName'),
        threshold: 0,
        payoutBonus: 0,
        depositBonus: 0,
        priority: 0,
      },
      {
        id: 'PRO',
        name: settings.get('growth.statusProName'),
        threshold: settings.get('growth.statusProThreshold'),
        payoutBonus: settings.get('growth.statusProPayoutBonus'),
        depositBonus: settings.get('growth.statusProDepositBonus'),
        priority: 1,
      },
      {
        id: 'VIP',
        name: settings.get('growth.statusVipName'),
        threshold: settings.get('growth.statusVipThreshold'),
        payoutBonus: settings.get('growth.statusVipPayoutBonus'),
        depositBonus: settings.get('growth.statusVipDepositBonus'),
        priority: 2,
      },
    ],
  };
}

/**
 * The level a lifetime deposit total reaches.
 *
 * Thresholds are read in order and the highest one met wins, so an operator
 * who sets them out of order (a VIP threshold below Pro's) still gets a
 * sensible answer rather than a gap.
 */
export function levelFor(totalDeposited: number, config: StatusConfig): StatusLevel {
  if (!config.enabled) return config.levels[0];
  let reached = config.levels[0];
  for (const level of config.levels) {
    if (totalDeposited >= level.threshold && level.priority >= reached.priority) reached = level;
  }
  return reached;
}

export interface StatusProgress {
  level: StatusLevel;
  /** The level above, or null at the top. */
  next: StatusLevel | null;
  /** Cents of further deposits needed to reach it. */
  remaining: number;
  /** How far through the current band, 0–100. */
  percent: number;
  totalDeposited: number;
}

export function progressFor(totalDeposited: number, config: StatusConfig): StatusProgress {
  const level = levelFor(totalDeposited, config);
  const next = config.enabled
    ? (config.levels.find((each) => each.priority === level.priority + 1) ?? null)
    : null;

  if (!next) {
    return { level, next: null, remaining: 0, percent: 100, totalDeposited };
  }

  const span = Math.max(next.threshold - level.threshold, 1);
  const done = Math.min(Math.max(totalDeposited - level.threshold, 0), span);
  return {
    level,
    next,
    remaining: Math.max(next.threshold - totalDeposited, 0),
    percent: Math.round((done / span) * 100),
    totalDeposited,
  };
}

/**
 * The payout this trader is quoted.
 *
 * The bonus is added to the market's payout for *this trader's own position*.
 * It reads their lifetime deposits and nothing else — not their open
 * positions, not the book, not their history — so it cannot steer a price or
 * pick an outcome, which is the platform's hard rule.
 */
export function payoutWithStatus(basePct: number, level: StatusLevel, config: StatusConfig): number {
  if (!config.enabled || level.payoutBonus === 0) return basePct;
  return Math.min(basePct + level.payoutBonus, config.maxPayoutPct);
}

/** The bonus a deposit of `amount` cents earns at this level, in cents. */
export function depositBonusFor(amount: number, level: StatusLevel, config: StatusConfig): number {
  if (!config.enabled || level.depositBonus <= 0 || amount <= 0) return 0;
  // rounded down: a bonus is never more generous than the percentage says
  return Math.floor((amount * level.depositBonus) / 100);
}
