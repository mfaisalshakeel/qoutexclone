import { EventEmitter } from 'node:events';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { log } from '../lib/logger.js';
import { badRequest } from '../lib/errors.js';
import { env } from '../env.js';

export const settingsEvents = new EventEmitter();

interface Definition<T extends z.ZodTypeAny> {
  schema: T;
  default: z.infer<T>;
  group: 'general' | 'trading' | 'wallet' | 'growth' | 'compliance' | 'security';
  label: string;
  help?: string;
  /** Safe to expose to unauthenticated clients and broadcast over ws. */
  public?: boolean;
}

const define = <T extends z.ZodTypeAny>(definition: Definition<T>) => definition;

const money = z.number().int().min(0); // cents
const percent = z.number().min(0).max(100);

/**
 * The registry is the single source of truth for runtime configuration: every
 * key carries its own schema, default and group, so the admin UI is generated
 * from it and a bad value can never reach the database.
 *
 * Defaults seed from env where an env var already existed, which keeps existing
 * deployments behaving exactly as before until an operator changes something.
 */
export const SETTINGS = {
  'general.siteName': define({
    schema: z.string().min(1).max(60),
    default: 'Quantex',
    group: 'general',
    label: 'Site name',
    public: true,
  }),
  'general.supportEmail': define({
    schema: z.string().email(),
    default: 'support@quantex.example',
    group: 'general',
    label: 'Support email',
    public: true,
  }),
  'general.maintenanceMode': define({
    schema: z.boolean(),
    default: false,
    group: 'general',
    label: 'Maintenance mode',
    help: 'Blocks trading and payments for non-administrators.',
    public: true,
  }),

  'trading.durations': define({
    schema: z.array(z.number().int().min(5).max(86400)).min(1).max(20),
    default: [5, 10, 15, 30, 60, 120, 180, 300, 600, 900, 1800, 3600, 14400],
    group: 'trading',
    label: 'Expiry durations (seconds)',
    help: 'The platform list. A market can offer a narrower set of its own.',
    public: true,
  }),
  'trading.expiryModes': define({
    schema: z
      .array(z.enum(['DURATION', 'CLOCK']))
      .min(1)
      .max(2),
    default: ['DURATION', 'CLOCK'],
    group: 'trading',
    label: 'Expiry modes offered',
    help: 'DURATION is a fixed length from purchase; CLOCK expires on the next boundary.',
    public: true,
  }),
  'trading.clockSteps': define({
    schema: z.array(z.number().int().min(30).max(86400)).min(1).max(10),
    default: [60, 300, 900, 1800, 3600],
    group: 'trading',
    label: 'Clock-time boundaries (seconds between them)',
    help: '300 offers 12:05, 12:10, 12:15 and so on.',
    public: true,
  }),
  'trading.clockCutoffSec': define({
    schema: z.number().int().min(0).max(600),
    default: 30,
    group: 'trading',
    label: 'Purchase cut-off before a clock expiry (seconds)',
    help: 'A boundary stops accepting positions this long before it lands.',
    public: true,
  }),
  'trading.clockHorizonSec': define({
    schema: z.number().int().min(60).max(86400),
    default: 4 * 3600,
    group: 'trading',
    label: 'How far ahead clock expiries are offered (seconds)',
    public: true,
  }),
  'trading.maxOpenTrades': define({
    schema: z.number().int().min(1).max(500),
    default: env.maxOpenTradesPerUser,
    group: 'trading',
    label: 'Max open positions per trader',
    public: true,
  }),
  'trading.practiceStartBalance': define({
    schema: money,
    default: 1_000_000,
    group: 'trading',
    label: 'Practice starting balance (cents)',
    public: true,
  }),
  'trading.practiceRefillBelow': define({
    schema: money,
    default: 0,
    group: 'trading',
    label: 'Allow practice refill below (cents)',
    help: '0 means a refill is always allowed.',
    public: true,
  }),

  'trading.minPayoutPct': define({
    schema: z.number().int().min(1).max(500),
    default: 20,
    group: 'trading',
    label: 'Minimum payout (%)',
    help: 'However many rules fire, a market never pays less than this.',
    public: true,
  }),
  'trading.maxPayoutPct': define({
    schema: z.number().int().min(1).max(500),
    default: 95,
    group: 'trading',
    label: 'Maximum payout (%)',
    help: 'The ceiling for a base payout plus every adjustment and bonus.',
    public: true,
  }),

  'trading.leaderboardEnabled': define({
    schema: z.boolean(),
    default: true,
    group: 'trading',
    label: "Show today's top traders",
    help: 'Live-money profit only, with masked names. A trader can opt out for themselves.',
    public: true,
  }),
  'trading.leaderboardSize': define({
    schema: z.number().int().min(3).max(100),
    default: 20,
    group: 'trading',
    label: 'Traders shown on the leaderboard',
    public: true,
  }),

  'trading.sentimentEnabled': define({
    schema: z.boolean(),
    default: true,
    group: 'trading',
    label: 'Show trader sentiment',
    help: "The share of staked money on each side, from the platform's own positions.",
    public: true,
  }),
  'trading.sentimentWindowMin': define({
    schema: z.number().int().min(1).max(1440),
    default: 15,
    group: 'trading',
    label: 'Sentiment window (minutes)',
    public: true,
  }),
  'trading.sentimentMinTrades': define({
    schema: z.number().int().min(1).max(1000),
    default: 5,
    group: 'trading',
    label: 'Positions needed before sentiment is shown',
    help: 'Below this, the terminal says there is not enough activity rather than showing noise.',
    public: true,
  }),

  'trading.hotkeysEnabled': define({
    schema: z.boolean(),
    default: true,
    group: 'trading',
    label: 'Keyboard shortcuts',
    help: 'Traders can still turn them off for themselves.',
    public: true,
  }),

  'trading.amountPresets': define({
    schema: z.array(z.number().int().min(1).max(100_000_000)).min(1).max(8),
    default: [1_000, 2_500, 5_000, 10_000, 25_000, 50_000],
    group: 'trading',
    label: 'Stake presets (cents)',
    help: "Shown on the ticket. Presets outside a market's own range are hidden for it.",
    public: true,
  }),
  'trading.amountStep': define({
    schema: z.number().int().min(1).max(10_000_000),
    default: 1_000,
    group: 'trading',
    label: 'Stake step for + and − (cents)',
    public: true,
  }),
  'trading.allowRepeat': define({
    schema: z.boolean(),
    default: true,
    group: 'trading',
    label: 'Allow repeating a position',
    help: 'Lets a trader re-open the same trade, or double it, from an open position.',
    public: true,
  }),

  'trading.maxPendingOrders': define({
    schema: z.number().int().min(0).max(200),
    default: 20,
    group: 'trading',
    label: 'Max waiting orders per trader',
    help: '0 turns pending orders off.',
    public: true,
  }),
  'trading.pendingGoodForSec': define({
    schema: z
      .number()
      .int()
      .min(60)
      .max(7 * 86400),
    default: 24 * 3600,
    group: 'trading',
    label: 'Longest an order may wait (seconds)',
    help: 'An order that has not filled by then is retired rather than waiting forever.',
    public: true,
  }),

  'risk.maxOpenStakePerUser': define({
    schema: money,
    default: 0,
    group: 'trading',
    label: 'Default max open stake per trader, per market (cents)',
    help: '0 means no limit. A market can override this with its own figure.',
    public: true,
  }),
  'risk.maxExposurePerDirection': define({
    schema: money,
    default: 0,
    group: 'trading',
    label: 'Default max open exposure per direction, per market (cents)',
    help: 'Counts live-money positions only. 0 means no limit. Rejects new stakes; never changes a price.',
    public: true,
  }),

  'wallet.minDepositUsd': define({
    schema: z.number().min(0),
    default: env.minDepositUsd,
    group: 'wallet',
    label: 'Minimum deposit (USD)',
    public: true,
  }),
  'wallet.minWithdrawUsd': define({
    schema: z.number().min(0),
    default: env.minWithdrawUsd,
    group: 'wallet',
    label: 'Minimum withdrawal (USD)',
    public: true,
  }),
  'wallet.withdrawFeePct': define({
    schema: percent,
    default: env.withdrawFeePct,
    group: 'wallet',
    label: 'Withdrawal fee (%)',
    public: true,
  }),
  'wallet.withdrawFlatFeeUsd': define({
    schema: z.number().min(0),
    default: env.withdrawFlatFeeUsd,
    group: 'wallet',
    label: 'Withdrawal flat fee (USD)',
    public: true,
  }),
  'wallet.depositWindowMinutes': define({
    schema: z.number().int().min(5).max(1440),
    default: env.depositWindowMinutes,
    group: 'wallet',
    label: 'Deposit invoice validity (minutes)',
  }),
  'wallet.autoApproveWithdrawals': define({
    schema: z.boolean(),
    default: env.autoApproveWithdrawals,
    group: 'wallet',
    label: 'Auto-approve withdrawals',
  }),
  'wallet.maxPendingWithdrawals': define({
    schema: z.number().int().min(1).max(20),
    default: 3,
    group: 'wallet',
    label: 'Max withdrawals in progress per trader',
  }),

  'growth.referralCommissionPct': define({
    schema: percent,
    default: env.referralCommissionPct,
    group: 'growth',
    label: 'Referral commission (%)',
    public: true,
  }),

  'compliance.requireKycForWithdrawal': define({
    schema: z.boolean(),
    default: env.requireKycForWithdrawal,
    group: 'compliance',
    label: 'Require verified identity to withdraw',
    public: true,
  }),
  'compliance.kycWithdrawalThresholdUsd': define({
    schema: z.number().min(0),
    default: env.kycWithdrawalThresholdUsd,
    group: 'compliance',
    label: 'Verification threshold (USD)',
    help: '0 requires verification for any withdrawal.',
    public: true,
  }),

  'security.authAttemptsPer15Min': define({
    schema: z.number().int().min(5).max(1000),
    // development runs the e2e suite repeatedly, which legitimately registers
    // and logs in many times from one address
    default: env.nodeEnv === 'production' ? 40 : 500,
    group: 'security',
    label: 'Sign-in and sign-up attempts per 15 minutes',
    help: 'Per IP address. Keep this low in production.',
  }),
  'security.sessionDays': define({
    schema: z.number().int().min(1).max(365),
    default: env.refreshTokenDays,
    group: 'security',
    label: 'Session lifetime (days)',
  }),
} as const;

export type SettingKey = keyof typeof SETTINGS;
export type SettingValue<K extends SettingKey> = z.infer<(typeof SETTINGS)[K]['schema']>;

/**
 * Cached, typed access to the `Setting` table.
 *
 * Reads are synchronous so hot paths (placing a trade, quoting a withdrawal)
 * never wait on the database. `load()` runs at boot; before that, and in unit
 * tests without a database, `get` returns the registry default.
 */
class SettingsService {
  private cache = new Map<SettingKey, unknown>();
  private loaded = false;

  async load(): Promise<void> {
    try {
      const rows = await prisma.setting.findMany();
      for (const row of rows) {
        const key = row.key as SettingKey;
        const definition = SETTINGS[key];
        if (!definition) continue; // a key from an older build: ignore, don't crash
        const parsed = definition.schema.safeParse(JSON.parse(row.value));
        if (parsed.success) this.cache.set(key, parsed.data);
        else log.boot.warn({ key, issues: parsed.error.issues }, 'stored setting is invalid, using default');
      }
      this.loaded = true;
      log.boot.info({ overrides: this.cache.size }, 'runtime settings loaded');
    } catch (err) {
      log.boot.error({ err }, 'could not load settings, using defaults');
    }
  }

  get<K extends SettingKey>(key: K): SettingValue<K> {
    if (this.cache.has(key)) return this.cache.get(key) as SettingValue<K>;
    return SETTINGS[key].default as SettingValue<K>;
  }

  /** Validates, persists, refreshes the cache and announces the change. */
  async set<K extends SettingKey>(key: K, value: unknown): Promise<SettingValue<K>> {
    const definition = SETTINGS[key];
    if (!definition) throw badRequest(`Unknown setting: ${key}`, 'unknown_setting');

    const parsed = definition.schema.safeParse(value);
    if (!parsed.success) {
      throw badRequest(`Invalid value for ${key}`, 'invalid_setting', parsed.error.issues);
    }

    await prisma.setting.upsert({
      where: { key },
      update: { value: JSON.stringify(parsed.data) },
      create: { key, value: JSON.stringify(parsed.data) },
    });
    this.cache.set(key, parsed.data);
    settingsEvents.emit('changed', { key, value: parsed.data, isPublic: Boolean(definition.public) });
    return parsed.data as SettingValue<K>;
  }

  async setMany(patch: Record<string, unknown>): Promise<Record<string, unknown>> {
    const applied: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(patch)) {
      applied[key] = await this.set(key as SettingKey, value);
    }
    return applied;
  }

  /** Restores a key to its registry default. */
  async reset<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
    await prisma.setting.deleteMany({ where: { key } });
    this.cache.delete(key);
    const value = SETTINGS[key].default as SettingValue<K>;
    settingsEvents.emit('changed', { key, value, isPublic: Boolean(SETTINGS[key].public) });
    return value;
  }

  /** Everything the admin settings screens render from. */
  describe() {
    return Object.entries(SETTINGS).map(([key, definition]) => ({
      key,
      group: definition.group,
      label: definition.label,
      help: definition.help,
      public: Boolean(definition.public),
      value: this.get(key as SettingKey),
      default: definition.default,
      overridden: this.cache.has(key as SettingKey),
      type: describeType(definition.default),
    }));
  }

  /** The subset safe for anonymous clients. */
  publicValues(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, definition] of Object.entries(SETTINGS)) {
      if (definition.public) out[key] = this.get(key as SettingKey);
    }
    return out;
  }

  get isLoaded(): boolean {
    return this.loaded;
  }

  /** Test seam: drop cached overrides. */
  _clear(): void {
    this.cache.clear();
    this.loaded = false;
  }
}

function describeType(value: unknown): 'boolean' | 'number' | 'string' | 'numberList' {
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  if (Array.isArray(value)) return 'numberList';
  return 'string';
}

export const settings = new SettingsService();
