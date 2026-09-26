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
  group: 'general' | 'trading' | 'wallet' | 'growth' | 'compliance' | 'security' | 'email' | 'seo' | 'localisation';
  label: string;
  help?: string;
  /** Safe to expose to unauthenticated clients and broadcast over ws. */
  public?: boolean;
  /**
   * A credential. It can be written from the back office but is never read
   * back out of it — the admin screen shows whether one is set, not what it is.
   */
  secret?: boolean;
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
  'general.siteUrl': define({
    schema: z.string().url(),
    default: 'http://localhost:5173',
    group: 'general',
    label: 'Public site address',
    help: 'Where links in emails point. Set this to your real domain before you send any.',
    public: true,
  }),
  'general.maintenanceMode': define({
    schema: z.boolean(),
    default: false,
    group: 'general',
    label: 'Maintenance mode',
    help: 'Blocks trading and payments for non-administrators. Admins and allowlisted IPs are unaffected.',
    public: true,
  }),
  'general.maintenanceMessage': define({
    schema: z.string().max(500),
    default: "We're doing scheduled maintenance. Trading and payments will be back shortly.",
    group: 'general',
    label: 'Maintenance message',
    help: 'Shown to every trader while maintenance mode is on.',
    public: true,
  }),
  'general.maintenanceAllowlist': define({
    schema: z.array(z.string().max(45)).max(50),
    default: [],
    group: 'general',
    label: 'Maintenance allowlist (IPs)',
    help: 'These addresses can still trade and move money while maintenance mode is on, same as an admin.',
  }),

  'general.logoLight': define({
    schema: z.string().max(500),
    default: '',
    group: 'general',
    label: 'Logo (light theme)',
    help: 'A hosted image URL. Empty keeps the default mark.',
    public: true,
  }),
  'general.logoDark': define({
    schema: z.string().max(500),
    default: '',
    group: 'general',
    label: 'Logo (dark theme)',
    help: 'A hosted image URL. Empty keeps the default mark.',
    public: true,
  }),
  'general.favicon': define({
    schema: z.string().max(500),
    default: '',
    group: 'general',
    label: 'Favicon',
    help: 'A hosted image URL. Empty keeps the default icon.',
    public: true,
  }),
  'general.defaultCurrency': define({
    schema: z.enum(['USD']),
    default: 'USD',
    group: 'general',
    label: 'Default currency',
    help: 'Balances and prices are stored and settled in USD; this only labels the platform for now.',
    public: true,
  }),
  'general.defaultTimezone': define({
    schema: z.string().max(60),
    default: 'UTC',
    group: 'general',
    label: 'Default timezone',
    help: 'An IANA zone (e.g. Europe/London). Used for timestamps the server itself renders, such as a new-device email — a signed-in trader always sees their own device’s time.',
  }),
  'general.defaultLanguage': define({
    schema: z.string().max(10),
    default: 'en',
    group: 'general',
    label: 'Default language',
    help: "A new account's language until they set their own in Account → Profile.",
    public: true,
  }),

  'notifications.enabled': define({
    schema: z.boolean(),
    default: true,
    group: 'general',
    label: 'Notification centre',
    help: 'Trade results, payments, tournaments and support replies collected in one place.',
    public: true,
  }),
  'notifications.practiceResults': define({
    schema: z.boolean(),
    default: false,
    group: 'general',
    label: 'Notify practice trade results',
    help: 'Off by default: a practice trader can settle a position every five seconds, and the centre fills with them.',
    public: true,
  }),
  'notifications.retentionDays': define({
    schema: z.number().int().min(1).max(365),
    default: 60,
    group: 'general',
    label: 'Keep notifications for (days)',
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

  'trading.minStakeCents': define({
    schema: money,
    default: 100,
    group: 'trading',
    label: 'Minimum stake, platform-wide (cents)',
    help: "A market's own minimum can only be stricter (higher) than this, never looser.",
    public: true,
  }),
  'trading.maxStakeCents': define({
    schema: money,
    default: 500_000,
    group: 'trading',
    label: 'Maximum stake, platform-wide (cents)',
    help: "A market's own maximum can only be stricter (lower) than this, never looser.",
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
  'trading.leaderboardOptOutDefault': define({
    schema: z.boolean(),
    default: false,
    group: 'trading',
    label: 'New accounts start opted out of the leaderboard',
    help: 'A trader can always change this for themselves afterwards.',
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

  'growth.statusEnabled': define({
    schema: z.boolean(),
    default: true,
    group: 'growth',
    label: 'Status levels',
    help: 'Off hides them everywhere and removes every perk.',
    public: true,
  }),
  'growth.statusStandardName': define({
    schema: z.string().min(1).max(24),
    default: 'Standard',
    group: 'growth',
    label: 'Level 1 name',
    public: true,
  }),
  'growth.statusProName': define({
    schema: z.string().min(1).max(24),
    default: 'Pro',
    group: 'growth',
    label: 'Level 2 name',
    public: true,
  }),
  'growth.statusVipName': define({
    schema: z.string().min(1).max(24),
    default: 'VIP',
    group: 'growth',
    label: 'Level 3 name',
    public: true,
  }),
  'growth.statusProThreshold': define({
    schema: money,
    default: 100_000, // $1,000 lifetime deposits
    group: 'growth',
    label: 'Level 2 threshold (cents of lifetime deposits)',
    public: true,
  }),
  'growth.statusVipThreshold': define({
    schema: money,
    default: 1_000_000, // $10,000 lifetime deposits
    group: 'growth',
    label: 'Level 3 threshold (cents of lifetime deposits)',
    public: true,
  }),
  'growth.statusProPayoutBonus': define({
    schema: percent,
    default: 2,
    group: 'growth',
    label: 'Level 2 payout bonus (percentage points)',
    help: "Added to the quoted payout on this trader's own positions. It never moves the price.",
    public: true,
  }),
  'growth.statusVipPayoutBonus': define({
    schema: percent,
    default: 4,
    group: 'growth',
    label: 'Level 3 payout bonus (percentage points)',
    public: true,
  }),
  'growth.statusProDepositBonus': define({
    schema: percent,
    default: 0,
    group: 'growth',
    label: 'Level 2 deposit bonus (%)',
    public: true,
  }),
  'growth.statusVipDepositBonus': define({
    schema: percent,
    default: 5,
    group: 'growth',
    label: 'Level 3 deposit bonus (%)',
    public: true,
  }),
  'growth.statusMaxPayoutPct': define({
    schema: percent,
    default: 95,
    group: 'growth',
    label: 'Payout ceiling with a status bonus (%)',
    help: 'A bonus can never take a payout above this.',
    public: true,
  }),

  'wallet.bonusesEnabled': define({
    schema: z.boolean(),
    default: true,
    group: 'wallet',
    label: 'Deposit bonuses',
    help: 'Off hides every offer and stops new bonuses carrying a turnover requirement.',
    public: true,
  }),
  'wallet.bonusTurnoverMultiplier': define({
    schema: z.number().int().min(0).max(100),
    default: 20,
    group: 'wallet',
    label: 'Default turnover multiplier',
    help: 'How many times a bonus must be staked before it can be withdrawn. 0 releases it at once.',
    public: true,
  }),

  'growth.marketplaceEnabled': define({
    schema: z.boolean(),
    default: true,
    group: 'growth',
    label: 'Marketplace',
    help: 'Off closes the shop and stops every item taking effect.',
    public: true,
  }),
  'growth.pointsPerDollarStaked': define({
    schema: z.number().min(0).max(1000),
    default: 1,
    group: 'growth',
    label: 'Loyalty points per dollar staked',
    help: 'Points buy marketplace items. They are never money and never withdrawable.',
  }),

  'growth.xpEnabled': define({
    schema: z.boolean(),
    default: true,
    group: 'growth',
    label: 'Experience and achievements',
    help: 'Off hides levels and badges everywhere and stops XP accruing.',
    public: true,
  }),
  'growth.xpPerDollarStaked': define({
    schema: z.number().min(0).max(1000),
    default: 1,
    group: 'growth',
    label: 'XP per dollar staked',
  }),
  'growth.xpPerWin': define({
    schema: z.number().int().min(0).max(10_000),
    default: 5,
    group: 'growth',
    label: 'XP for a winning position',
  }),
  'growth.xpDailyBonus': define({
    schema: z.number().int().min(0).max(10_000),
    default: 25,
    group: 'growth',
    label: 'XP for the first position settled each day',
  }),
  'growth.xpFromPractice': define({
    schema: z.boolean(),
    default: false,
    group: 'growth',
    label: 'Practice trading earns XP',
    help: 'Off by default: a practice balance refills, so XP from it is unlimited.',
  }),
  'growth.xpLevelBase': define({
    schema: z.number().int().min(10).max(1_000_000),
    default: 100,
    group: 'growth',
    label: 'XP needed for level 2',
  }),
  'growth.xpLevelCurve': define({
    schema: z.number().min(1).max(4),
    default: 1.6,
    group: 'growth',
    label: 'Level curve',
    help: 'Higher makes each level cost more than the last. 1 is a flat ladder.',
  }),

  'wallet.maxDailyWithdrawalCents': define({
    schema: money,
    default: 5_000_000, // $50,000
    group: 'wallet',
    label: 'Maximum withdrawn per trader per day (cents)',
    help: '0 removes the cap. Counts requests still pending or in progress, not only completed ones.',
    public: true,
  }),

  'compliance.limitCoolingOffHours': define({
    schema: z.number().int().min(0).max(168),
    default: 24,
    group: 'compliance',
    label: 'Cooling-off before a limit is loosened (hours)',
    help: 'Tightening a limit always applies at once. 0 removes the wait entirely.',
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
  'email.enabled': define({
    schema: z.boolean(),
    default: false,
    group: 'email',
    label: 'Send email',
    help: 'Off keeps every message in the outbox without delivering it.',
  }),
  'email.host': define({
    schema: z.string().max(200),
    default: env.smtp.host,
    group: 'email',
    label: 'SMTP host',
  }),
  'email.port': define({
    schema: z.number().int().min(1).max(65535),
    default: env.smtp.port,
    group: 'email',
    label: 'SMTP port',
    help: '465 for implicit TLS, 587 for STARTTLS.',
  }),
  'email.secure': define({
    schema: z.boolean(),
    default: env.smtp.port === 465,
    group: 'email',
    label: 'Implicit TLS',
    help: 'On for port 465. Off lets the connection upgrade with STARTTLS.',
  }),
  'email.user': define({
    schema: z.string().max(200),
    default: env.smtp.user,
    group: 'email',
    label: 'SMTP username',
  }),
  'email.password': define({
    schema: z.string().max(400),
    default: env.smtp.password,
    group: 'email',
    label: 'SMTP password',
    help: 'Stored on the server and never shown again once saved.',
    secret: true,
  }),
  'email.fromName': define({
    schema: z.string().max(80),
    default: 'Quantex',
    group: 'email',
    label: 'From name',
  }),
  'email.fromAddress': define({
    schema: z.string().max(200),
    default: 'no-reply@quantex.example',
    group: 'email',
    label: 'From address',
  }),
  'email.replyTo': define({
    schema: z.string().max(200),
    default: '',
    group: 'email',
    label: 'Reply-to address',
    help: 'Left empty, replies go to the from address.',
  }),

  'security.emailVerification': define({
    schema: z.enum(['off', 'optional', 'required']),
    default: 'optional',
    group: 'security',
    label: 'Email verification',
    help: 'Optional asks and nags. Required blocks deposits and withdrawals until the address is confirmed.',
    public: true,
  }),
  'security.emailVerificationHours': define({
    schema: z.number().int().min(1).max(168),
    default: 48,
    group: 'security',
    label: 'Confirmation link lifetime (hours)',
  }),
  'security.newDeviceAlerts': define({
    schema: z.boolean(),
    default: true,
    group: 'security',
    label: 'Email on a sign-in from a new device',
  }),
  'security.passwordMinLength': define({
    schema: z.number().int().min(8).max(64),
    default: 8,
    group: 'security',
    label: 'Minimum password length',
    public: true,
  }),
  'security.passwordRequireMixedCase': define({
    schema: z.boolean(),
    default: true,
    group: 'security',
    label: 'Password needs upper and lower case',
    public: true,
  }),
  'security.passwordRequireNumber': define({
    schema: z.boolean(),
    default: true,
    group: 'security',
    label: 'Password needs a number',
    public: true,
  }),
  'security.passwordRequireSymbol': define({
    schema: z.boolean(),
    default: false,
    group: 'security',
    label: 'Password needs a symbol',
    public: true,
  }),
  'security.sessionDays': define({
    schema: z.number().int().min(1).max(365),
    default: env.refreshTokenDays,
    group: 'security',
    label: 'Session lifetime (days)',
  }),
  'security.apiRateLimitPerMinute': define({
    schema: z.number().int().min(60).max(10_000),
    default: 600,
    group: 'security',
    label: 'API requests per minute, per IP',
    help: 'Applies to every request. Sign-in and sign-up have their own, tighter limit above.',
  }),
  'security.corsOrigins': define({
    schema: z.array(z.string().max(200)).min(1).max(50),
    default: env.corsOrigins,
    group: 'security',
    label: 'Allowed CORS origins',
    help: 'Which sites may call the API from a browser. "*" allows any origin.',
  }),

  /**
   * Phase 7 builds the public site's actual rendering (meta tags,
   * `/sitemap.xml`, `/robots.txt`); these are the values it will read, kept
   * here so an operator can set them — and Phase 7's own renderer can find
   * them already in place — before that phase exists.
   */
  'seo.titleTemplate': define({
    schema: z.string().max(100),
    default: '%s — Quantex',
    group: 'seo',
    label: 'Title template',
    help: 'A page’s own title fills in the %s.',
    public: true,
  }),
  'seo.metaDescription': define({
    schema: z.string().max(300),
    default:
      'Trade fixed-payout options on currencies, crypto, commodities, stocks and indices. Practice free, deposit and withdraw in crypto.',
    group: 'seo',
    label: 'Default meta description',
    public: true,
  }),
  'seo.metaKeywords': define({
    schema: z.array(z.string().max(40)).max(30),
    default: ['binary options', 'crypto trading', 'options trading', 'practice trading account'],
    group: 'seo',
    label: 'Meta keywords',
    public: true,
  }),
  'seo.ogImageUrl': define({
    schema: z.string().max(500),
    default: '',
    group: 'seo',
    label: 'Open Graph image URL',
    help: 'Shown when a link to the site is shared. Empty omits the tag.',
    public: true,
  }),
  'seo.twitterCard': define({
    schema: z.enum(['summary', 'summary_large_image']),
    default: 'summary_large_image',
    group: 'seo',
    label: 'Twitter card type',
    public: true,
  }),
  'seo.canonicalBaseUrl': define({
    schema: z.string().max(200),
    default: 'http://localhost:5173',
    group: 'seo',
    label: 'Canonical base URL',
    help: 'The domain every canonical and Open Graph URL is built from.',
    public: true,
  }),
  'seo.robotsIndexing': define({
    schema: z.boolean(),
    default: true,
    group: 'seo',
    label: 'Allow search engines to index the site',
    help: 'Off publishes a sitewide Disallow — for a staging deploy that is not ready to be found.',
    public: true,
  }),
  'seo.sitemapEnabled': define({
    schema: z.boolean(),
    default: true,
    group: 'seo',
    label: 'Publish /sitemap.xml',
    public: true,
  }),
  'seo.gaId': define({
    schema: z.string().max(40),
    default: '',
    group: 'seo',
    label: 'Google Analytics measurement ID',
    help: 'e.g. G-XXXXXXXXXX. Empty loads no analytics script.',
  }),
  'seo.gtmId': define({
    schema: z.string().max(40),
    default: '',
    group: 'seo',
    label: 'Google Tag Manager ID',
    help: 'e.g. GTM-XXXXXXX. Empty loads no tag manager.',
  }),
  'seo.searchConsoleVerification': define({
    schema: z.string().max(200),
    default: '',
    group: 'seo',
    label: 'Search Console verification code',
    help: 'The content of the google-site-verification meta tag Search Console gives you.',
  }),
  'seo.customHeadSnippet': define({
    schema: z.string().max(4000),
    default: '',
    group: 'seo',
    label: 'Custom <head> snippet',
    help: 'Sanitised before it is ever rendered into a page — scripts and event handlers are stripped.',
  }),

  'localisation.enabledLanguages': define({
    schema: z.array(z.string().min(2).max(10)).min(1).max(50),
    default: ['en'],
    group: 'localisation',
    label: 'Enabled languages',
    help: 'ISO codes. The first is the default for a visitor with no preference of their own.',
    public: true,
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
      secret: Boolean(definition.secret),
      // a credential is never handed back, not even to an administrator
      value: definition.secret ? '' : this.get(key as SettingKey),
      hasValue: definition.secret ? Boolean(this.get(key as SettingKey)) : undefined,
      default: definition.secret ? '' : definition.default,
      overridden: this.cache.has(key as SettingKey),
      type: describeType(definition),
    }));
  }

  /** The subset safe for anonymous clients. */
  publicValues(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, definition] of Object.entries(SETTINGS)) {
      if (definition.public && !definition.secret) out[key] = this.get(key as SettingKey);
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

/**
 * Read off the schema rather than the default value: an empty-by-default
 * list (the maintenance allowlist) still needs to render as a list of
 * strings, not fall through to a plain text box.
 */
function describeType(
  definition: Definition<z.ZodTypeAny>,
): 'boolean' | 'number' | 'string' | 'numberList' | 'stringList' {
  const { default: value, schema } = definition;
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  if (Array.isArray(value)) {
    const element = (schema as unknown as { _def?: { type?: z.ZodTypeAny } })._def?.type;
    return element instanceof z.ZodString ? 'stringList' : 'numberList';
  }
  return 'string';
}

export const settings = new SettingsService();
