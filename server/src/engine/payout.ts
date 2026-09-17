/**
 * Payout resolution.
 *
 * A market has a base payout; rules move it. A rule can look at the clock (a
 * quiet Asian session pays less), the calendar (a scheduled news window pays
 * less), or how much the market is actually moving. A trader's status adds a
 * bonus on top, which Phase 4 supplies.
 *
 * Two rules shape this file:
 *
 * 1. It is **pure**. Same inputs, same payout, forever — so an operator can
 *    preview exactly what a rule will do before saving it.
 * 2. It **never reads a trader, a position or the house's exposure.** Payout is
 *    a property of the market and the moment, not of who is asking or what they
 *    hold. This is the same hard rule the price engine lives under, and it is
 *    tested the same way.
 */

export type PayoutRuleKind = 'TIME_OF_DAY' | 'VOLATILITY' | 'SCHEDULE';

/** Minutes from midnight UTC; a window may wrap past midnight. */
export interface TimeOfDayConfig {
  /** UTC days the window applies to, 0 = Sunday. Empty or absent means daily. */
  days?: number[];
  fromMinute: number;
  toMinute: number;
}

/**
 * Compares the market's realised volatility with the volatility it is
 * configured for, so one rule can cover every market: "when a market is moving
 * more than 1.5× its normal, pay less".
 */
export interface VolatilityConfig {
  /** How far back the realised figure is measured, in minutes. */
  windowMinutes: number;
  aboveRatio?: number;
  belowRatio?: number;
}

/** A dated window, for a news release or a maintenance period. */
export interface ScheduleConfig {
  from: string;
  to: string;
}

export type PayoutRuleConfig = TimeOfDayConfig | VolatilityConfig | ScheduleConfig;

export interface PayoutRule {
  id: string;
  name: string;
  kind: PayoutRuleKind;
  assetId: string | null;
  assetClass: string | null;
  adjustment: number;
  config: unknown;
  priority: number;
  exclusive: boolean;
  enabled: boolean;
}

export interface PayoutMarket {
  id: string;
  assetClass: string;
  payoutPct: number;
  /** The per-minute volatility the market is configured for. */
  volatility: number;
}

export interface PayoutInput {
  market: PayoutMarket;
  rules: PayoutRule[];
  at: Date;
  /** Realised per-minute volatility, when the feed has enough history. */
  realisedVolatility?: number | null;
  /** Phase 4 status bonus, in percentage points. */
  statusBonusPct?: number;
  minPct: number;
  maxPct: number;
}

export interface AppliedRule {
  id: string;
  name: string;
  kind: PayoutRuleKind;
  adjustment: number;
}

export interface PayoutResult {
  /** The payout a trade opened now would be locked at. */
  pct: number;
  basePct: number;
  applied: AppliedRule[];
  statusBonusPct: number;
  /** True when a clamp, not the rules, decided the final number. */
  clamped: boolean;
}

const MINUTES_PER_DAY = 1440;

/** Does a rule's scope cover this market? */
export function scopeMatches(rule: PayoutRule, market: PayoutMarket): boolean {
  if (rule.assetId) return rule.assetId === market.id;
  if (rule.assetClass) return rule.assetClass === market.assetClass;
  return true;
}

/**
 * Is `minute` inside [from, to)? A window whose end is not after its start runs
 * past midnight, which is how the Asian session is written.
 */
export function inMinuteWindow(minute: number, from: number, to: number): boolean {
  const start = wrapMinute(from);
  const end = wrapMinute(to);
  if (start === end) return true; // a full day
  return start < end ? minute >= start && minute < end : minute >= start || minute < end;
}

function wrapMinute(value: number): number {
  const rounded = Math.floor(Number.isFinite(value) ? value : 0);
  return ((rounded % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

function matchesTimeOfDay(config: TimeOfDayConfig, at: Date): boolean {
  const minute = at.getUTCHours() * 60 + at.getUTCMinutes();
  if (config.days?.length && !config.days.includes(at.getUTCDay())) {
    // a window that wraps midnight belongs to the day it started on
    const startsEarlier = wrapMinute(config.toMinute) <= wrapMinute(config.fromMinute);
    const previousDay = (at.getUTCDay() + 6) % 7;
    if (!startsEarlier || !config.days.includes(previousDay)) return false;
    return minute < wrapMinute(config.toMinute);
  }
  return inMinuteWindow(minute, config.fromMinute, config.toMinute);
}

function matchesVolatility(
  config: VolatilityConfig,
  market: PayoutMarket,
  realised: number | null | undefined,
): boolean {
  // no measurement yet means the rule simply does not fire: a payout must never
  // be guessed from missing data
  if (realised == null || !(realised >= 0) || !(market.volatility > 0)) return false;
  const ratio = realised / market.volatility;
  if (config.aboveRatio != null && ratio <= config.aboveRatio) return false;
  if (config.belowRatio != null && ratio >= config.belowRatio) return false;
  // a rule with neither bound would fire always, which is a misconfiguration
  return config.aboveRatio != null || config.belowRatio != null;
}

function matchesSchedule(config: ScheduleConfig, at: Date): boolean {
  const from = Date.parse(config.from);
  const to = Date.parse(config.to);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return false;
  const now = at.getTime();
  return now >= from && now < to;
}

/** Does this rule fire for this market at this instant? */
export function ruleFires(rule: PayoutRule, input: PayoutInput): boolean {
  if (!rule.enabled || !scopeMatches(rule, input.market)) return false;
  switch (rule.kind) {
    case 'TIME_OF_DAY':
      return matchesTimeOfDay(rule.config as TimeOfDayConfig, input.at);
    case 'VOLATILITY':
      return matchesVolatility(rule.config as VolatilityConfig, input.market, input.realisedVolatility);
    case 'SCHEDULE':
      return matchesSchedule(rule.config as ScheduleConfig, input.at);
    default:
      // an unknown kind is ignored rather than allowed to change a payout
      return false;
  }
}

/**
 * The payout for a market right now, with every adjustment that fired.
 *
 * Rules are applied in priority order and their adjustments add up. A rule
 * marked exclusive stops the ones after it, which is how "during this news
 * window, nothing else matters" is expressed.
 */
export function resolvePayout(input: PayoutInput): PayoutResult {
  const basePct = input.market.payoutPct;
  const statusBonusPct = Math.round(input.statusBonusPct ?? 0);
  const applied: AppliedRule[] = [];

  const ordered = [...input.rules].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));

  for (const rule of ordered) {
    if (!ruleFires(rule, input)) continue;
    applied.push({ id: rule.id, name: rule.name, kind: rule.kind, adjustment: rule.adjustment });
    if (rule.exclusive) break;
  }

  const raw = basePct + applied.reduce((sum, rule) => sum + rule.adjustment, 0) + statusBonusPct;
  const pct = Math.min(Math.max(Math.round(raw), input.minPct), input.maxPct);

  return { pct, basePct, applied, statusBonusPct, clamped: pct !== Math.round(raw) };
}
