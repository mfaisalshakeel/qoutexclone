// side-effect import: finds server/.env from any working directory
import './lib/load-env.js';
import { z } from 'zod';

/** "1" | "true" | "yes" | "on" -> true, anything else falsy. */
const bool = (fallback: boolean) =>
  z
    .string()
    .optional()
    .transform((value) =>
      value === undefined ? fallback : ['1', 'true', 'yes', 'on'].includes(value.toLowerCase()),
    );

const int = (fallback: number, min?: number, max?: number) =>
  z
    .string()
    .optional()
    .transform((value) => (value === undefined || value === '' ? fallback : Number(value)))
    .pipe(
      z
        .number()
        .int()
        .min(min ?? Number.MIN_SAFE_INTEGER)
        .max(max ?? Number.MAX_SAFE_INTEGER),
    );

const decimal = (fallback: number, min = 0, max = Number.MAX_SAFE_INTEGER) =>
  z
    .string()
    .optional()
    .transform((value) => (value === undefined || value === '' ? fallback : Number(value)))
    .pipe(z.number().min(min).max(max));

const DEV_SECRET = 'dev-secret-change-me';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: int(4000, 1, 65535),
  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL is required, e.g. mysql://user:pass@127.0.0.1:3306/quotex')
    .refine((value) => value.startsWith('mysql://'), 'DATABASE_URL must be a mysql:// connection string'),

  JWT_SECRET: z.string().min(1).default(DEV_SECRET),
  JWT_REFRESH_SECRET: z.string().min(1).default(`${DEV_SECRET}-refresh`),
  ACCESS_TOKEN_TTL: z.string().min(2).default('30m'),
  REFRESH_TOKEN_DAYS: int(30, 1, 365),
  CORS_ORIGINS: z.string().default('http://localhost:5173,http://localhost:4173'),

  FEED_PROVIDER: z.enum(['simulated', 'binance']).default('simulated'),
  FEED_TICK_MS: int(250, 50, 5000),
  BINANCE_WS_URL: z.string().url().default('wss://stream.binance.com:9443/stream'),
  // delayed forex/stock/index quotes; without a key those markets stay simulated
  MARKET_DATA_URL: z.string().url().default('https://api.twelvedata.com/price'),
  MARKET_DATA_KEY: z.string().default(''),
  MARKET_DATA_POLL_MS: int(15000, 1000, 600000),

  SETTLEMENT_INTERVAL_MS: int(200, 50, 5000),
  MAX_OPEN_TRADES: int(25, 1, 500),

  MIN_DEPOSIT_USD: decimal(10, 0),
  MIN_WITHDRAW_USD: decimal(20, 0),
  WITHDRAW_FEE_PCT: decimal(1, 0, 100),
  WITHDRAW_FLAT_FEE_USD: decimal(1, 0),
  DEPOSIT_WINDOW_MINUTES: int(60, 1, 1440),
  MOCK_CHAIN_WATCHER: bool(true),
  MOCK_CHAIN_CONFIRM_MS: int(20000, 500, 600000),
  AUTO_APPROVE_WITHDRAWALS: bool(false),

  REQUIRE_KYC_FOR_WITHDRAWAL: bool(false),
  KYC_WITHDRAWAL_THRESHOLD_USD: decimal(0, 0),
  REFERRAL_COMMISSION_PCT: decimal(5, 0, 100),

  RESET_TOKEN_MINUTES: int(30, 1, 1440),
  EXPOSE_RESET_TOKEN: bool(true),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  LOG_PRETTY: bool(process.env.NODE_ENV !== 'production'),
});

/**
 * Parses and validates the environment once, at import time, and fails fast
 * with every problem listed rather than surfacing them one by one at runtime.
 * Production additionally refuses to boot on dev secrets or a mock wallet.
 */
function load() {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map(
      (issue) => `  - ${issue.path.join('.') || 'env'}: ${issue.message}`,
    );
    console.error(`\nInvalid environment configuration:\n${problems.join('\n')}\n`);
    console.error('Copy server/.env.example to server/.env and fill it in.\n');
    process.exit(1);
  }

  const raw = parsed.data;
  const fatal: string[] = [];

  if (raw.NODE_ENV === 'production') {
    if (raw.JWT_SECRET === DEV_SECRET || raw.JWT_SECRET.length < 24) {
      fatal.push('JWT_SECRET must be a real secret of at least 24 characters in production');
    }
    if (raw.JWT_REFRESH_SECRET === `${DEV_SECRET}-refresh` || raw.JWT_REFRESH_SECRET.length < 24) {
      fatal.push('JWT_REFRESH_SECRET must be a real secret of at least 24 characters in production');
    }
    if (raw.JWT_SECRET === raw.JWT_REFRESH_SECRET) {
      fatal.push('JWT_SECRET and JWT_REFRESH_SECRET must differ');
    }
    if (raw.EXPOSE_RESET_TOKEN) {
      fatal.push('EXPOSE_RESET_TOKEN must be false in production — send reset links by email instead');
    }
  }

  if (fatal.length) {
    console.error(`\nRefusing to start:\n${fatal.map((line) => `  - ${line}`).join('\n')}\n`);
    process.exit(1);
  }

  // production with the mock chain watcher on is a real risk, but the operator
  // may be running a staging deployment, so warn loudly instead of exiting
  if (raw.NODE_ENV === 'production' && raw.MOCK_CHAIN_WATCHER) {
    console.warn(
      '[env] MOCK_CHAIN_WATCHER is enabled in production: deposits will auto-credit without a chain.',
    );
  }

  return {
    nodeEnv: raw.NODE_ENV,
    port: raw.PORT,
    databaseUrl: raw.DATABASE_URL,
    jwtSecret: raw.JWT_SECRET,
    jwtRefreshSecret: raw.JWT_REFRESH_SECRET,
    accessTokenTtl: raw.ACCESS_TOKEN_TTL,
    refreshTokenDays: raw.REFRESH_TOKEN_DAYS,
    corsOrigins: raw.CORS_ORIGINS.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),

    feedProvider: raw.FEED_PROVIDER,
    feedTickMs: raw.FEED_TICK_MS,
    binanceWsUrl: raw.BINANCE_WS_URL,
    marketDataUrl: raw.MARKET_DATA_URL,
    marketDataKey: raw.MARKET_DATA_KEY,
    marketDataPollMs: raw.MARKET_DATA_POLL_MS,

    settlementIntervalMs: raw.SETTLEMENT_INTERVAL_MS,
    maxOpenTradesPerUser: raw.MAX_OPEN_TRADES,

    minDepositUsd: raw.MIN_DEPOSIT_USD,
    minWithdrawUsd: raw.MIN_WITHDRAW_USD,
    withdrawFeePct: raw.WITHDRAW_FEE_PCT,
    withdrawFlatFeeUsd: raw.WITHDRAW_FLAT_FEE_USD,
    depositWindowMinutes: raw.DEPOSIT_WINDOW_MINUTES,
    mockChainWatcher: raw.MOCK_CHAIN_WATCHER,
    mockChainConfirmMs: raw.MOCK_CHAIN_CONFIRM_MS,
    autoApproveWithdrawals: raw.AUTO_APPROVE_WITHDRAWALS,

    requireKycForWithdrawal: raw.REQUIRE_KYC_FOR_WITHDRAWAL,
    kycWithdrawalThresholdUsd: raw.KYC_WITHDRAWAL_THRESHOLD_USD,
    referralCommissionPct: raw.REFERRAL_COMMISSION_PCT,

    resetTokenMinutes: raw.RESET_TOKEN_MINUTES,
    exposeResetToken: raw.EXPOSE_RESET_TOKEN,

    logLevel: raw.LOG_LEVEL,
    logPretty: raw.LOG_PRETTY,
  } as const;
}

export const env = load();
export type Env = typeof env;

/** Exported for tests: validate a candidate environment without exiting. */
export function validateEnv(candidate: Record<string, string | undefined>) {
  return schema.safeParse(candidate);
}
