import { EventEmitter } from 'node:events';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { log } from '../lib/logger.js';
import { marketFeed } from '../engine/feed.js';
import { settings } from './settings.js';
import {
  resolvePayout,
  type PayoutMarket,
  type PayoutResult,
  type PayoutRule,
  type PayoutRuleKind,
} from '../engine/payout.js';

/** Rules change rarely and are read on every quote, so they are cached. */
const REFRESH_MS = 60_000;

const MINUTE = z.number().int().min(0).max(1440);

export const RULE_CONFIG_SCHEMAS = {
  TIME_OF_DAY: z.object({
    days: z.array(z.number().int().min(0).max(6)).max(7).optional(),
    fromMinute: MINUTE,
    toMinute: MINUTE,
  }),
  VOLATILITY: z
    .object({
      windowMinutes: z.number().int().min(2).max(240).default(15),
      aboveRatio: z.number().min(0).max(20).optional(),
      belowRatio: z.number().min(0).max(20).optional(),
    })
    .refine((value) => value.aboveRatio != null || value.belowRatio != null, {
      message: 'Set an above or below threshold, or the rule would always fire',
    }),
  SCHEDULE: z
    .object({ from: z.string().datetime(), to: z.string().datetime() })
    .refine((value) => Date.parse(value.to) > Date.parse(value.from), {
      message: 'The window must end after it starts',
    }),
} as const;

export const RULE_KINDS = Object.keys(RULE_CONFIG_SCHEMAS) as PayoutRuleKind[];

/** Validates a rule's configuration against the shape its kind requires. */
export function parseRuleConfig(kind: PayoutRuleKind, config: unknown) {
  const schema = RULE_CONFIG_SCHEMAS[kind];
  if (!schema) throw new Error(`Unknown payout rule kind: ${kind}`);
  return schema.parse(config);
}

/** What the realtime channel sends when a market's payout moves. */
export interface LivePayout {
  pct: number;
  basePct: number;
  adjustments: { name: string; kind: PayoutRuleKind; adjustment: number }[];
}

export const payoutEvents = new EventEmitter();

class PayoutService {
  private rules: PayoutRule[] = [];
  private timer: NodeJS.Timeout | null = null;
  /** Last resolved payout per symbol, so only real changes are broadcast. */
  private lastPct = new Map<string, number>();

  async load(): Promise<void> {
    const rows = await prisma.payoutRule.findMany({ orderBy: { priority: 'asc' } });
    this.rules = rows.map((row) => ({
      id: row.id,
      name: row.name,
      kind: row.kind as PayoutRuleKind,
      assetId: row.assetId,
      assetClass: row.assetClass,
      adjustment: row.adjustment,
      config: row.config,
      priority: row.priority,
      exclusive: row.exclusive,
      enabled: row.enabled,
    }));
    log.boot.info({ rules: this.rules.length }, 'payout rules loaded');
  }

  start(): void {
    if (this.timer) return;
    // a SCHEDULE window opens without anyone touching the admin screen
    this.timer = setInterval(() => void this.load().catch(() => undefined), REFRESH_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  all(): PayoutRule[] {
    return this.rules;
  }

  /** The payout a trade on this market would be locked at right now. */
  resolve(
    market: PayoutMarket & { symbol: string },
    options: { at?: Date; statusBonusPct?: number } = {},
  ): PayoutResult {
    const at = options.at ?? new Date();
    const window = this.volatilityWindow(market);
    return resolvePayout({
      market,
      rules: this.rules,
      at,
      realisedVolatility: window ? marketFeed.realisedVolatility(market.symbol, window) : null,
      statusBonusPct: options.statusBonusPct ?? 0,
      minPct: settings.get('trading.minPayoutPct'),
      maxPct: settings.get('trading.maxPayoutPct'),
    });
  }

  /**
   * The widest lookback any volatility rule in scope asks for, or null when
   * none does — measuring is not free, so it is skipped when nothing reads it.
   */
  private volatilityWindow(market: PayoutMarket): number | null {
    let window: number | null = null;
    for (const rule of this.rules) {
      if (!rule.enabled || rule.kind !== 'VOLATILITY') continue;
      if (rule.assetId && rule.assetId !== market.id) continue;
      if (!rule.assetId && rule.assetClass && rule.assetClass !== market.assetClass) continue;
      const minutes = (rule.config as { windowMinutes?: number }).windowMinutes ?? 15;
      window = Math.max(window ?? 0, minutes);
    }
    return window;
  }

  /**
   * Payouts that have moved since the last call, for the realtime channel.
   *
   * The reason rides along with the figure: a terminal that shows a reduced
   * payout has to be able to say what reduced it, and a rule opening mid-session
   * must not need a page reload to be visible.
   */
  changedPayouts(markets: (PayoutMarket & { symbol: string })[]): Record<string, LivePayout> {
    const changed: Record<string, LivePayout> = {};
    for (const market of markets) {
      const resolved = this.resolve(market);
      if (this.lastPct.get(market.symbol) === resolved.pct) continue;
      this.lastPct.set(market.symbol, resolved.pct);
      changed[market.symbol] = {
        pct: resolved.pct,
        basePct: resolved.basePct,
        adjustments: resolved.applied.map((rule) => ({
          name: rule.name,
          kind: rule.kind,
          adjustment: rule.adjustment,
        })),
      };
    }
    return changed;
  }

  /** Test seam. */
  _set(rules: PayoutRule[]): void {
    this.rules = rules;
    this.lastPct.clear();
  }
}

export const payouts = new PayoutService();
