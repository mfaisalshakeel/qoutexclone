import { settings } from './settings.js';

/**
 * Experience and levels.
 *
 * XP is a record of activity, not money: it never reaches a balance, it cannot
 * be spent here, and nothing in the settlement path depends on it. The maths
 * is pure and takes its configuration as an argument so the curve can be
 * tested — which matters, because a level ladder that is wrong is wrong for
 * everybody at once and cannot be quietly corrected afterwards.
 */

export interface XpConfig {
  enabled: boolean;
  perDollarStaked: number;
  perWin: number;
  dailyBonus: number;
  fromPractice: boolean;
  levelBase: number;
  levelCurve: number;
}

export function xpConfig(): XpConfig {
  return {
    enabled: settings.get('growth.xpEnabled'),
    perDollarStaked: settings.get('growth.xpPerDollarStaked'),
    perWin: settings.get('growth.xpPerWin'),
    dailyBonus: settings.get('growth.xpDailyBonus'),
    fromPractice: settings.get('growth.xpFromPractice'),
    levelBase: settings.get('growth.xpLevelBase'),
    levelCurve: settings.get('growth.xpLevelCurve'),
  };
}

/**
 * The total XP needed to *reach* a level. Level 1 is where everyone starts.
 *
 * `base * (level - 1) ^ curve`: a curve of 1 is a flat ladder where every
 * level costs the same, and anything above it makes each one cost more.
 */
export function xpForLevel(level: number, config: XpConfig): number {
  if (level <= 1) return 0;
  return Math.round(config.levelBase * Math.pow(level - 1, config.levelCurve));
}

/** The level a total of XP has reached. Never below 1. */
export function levelForXp(xp: number, config: XpConfig): number {
  if (xp < config.levelBase) return 1;
  // the curve is monotonic, so walking up is exact and bounded in practice
  let level = 1;
  while (xpForLevel(level + 1, config) <= xp && level < 999) level += 1;
  return level;
}

export interface LevelProgress {
  level: number;
  xp: number;
  /** XP at which this level began. */
  levelFloor: number;
  /** XP at which the next one starts. */
  nextLevelAt: number;
  /** XP still to earn for the next level. */
  remaining: number;
  /** How far through the current level, 0–100. */
  percent: number;
}

export function levelProgress(xp: number, config: XpConfig): LevelProgress {
  const level = levelForXp(xp, config);
  const levelFloor = xpForLevel(level, config);
  const nextLevelAt = xpForLevel(level + 1, config);
  const span = Math.max(nextLevelAt - levelFloor, 1);
  const done = Math.min(Math.max(xp - levelFloor, 0), span);
  return {
    level,
    xp,
    levelFloor,
    nextLevelAt,
    remaining: Math.max(nextLevelAt - xp, 0),
    percent: Math.round((done / span) * 100),
  };
}

export interface SettledForXp {
  accountType: string;
  /** Stake in cents. */
  stake: number;
  status: string;
}

/**
 * What a settled position is worth.
 *
 * Practice is excluded unless an operator says otherwise: a practice balance
 * refills, so XP from it would be unlimited and the ladder would mean nothing.
 * `firstToday` carries the once-a-day activity bonus.
 */
export function xpForTrade(
  trade: SettledForXp,
  config: XpConfig,
  options: { firstToday: boolean } = { firstToday: false },
): number {
  if (!config.enabled) return 0;
  if (trade.accountType === 'DEMO' && !config.fromPractice) return 0;
  if (trade.status !== 'WON' && trade.status !== 'LOST' && trade.status !== 'REFUNDED') return 0;

  const dollars = trade.stake / 100;
  let earned = Math.floor(dollars * config.perDollarStaked);
  if (trade.status === 'WON') earned += config.perWin;
  if (options.firstToday) earned += config.dailyBonus;
  return Math.max(earned, 0);
}

/** The UTC day a timestamp falls in, as the key the daily bonus is keyed on. */
export function dayKey(at: Date | number = Date.now()): string {
  return new Date(at).toISOString().slice(0, 10);
}
