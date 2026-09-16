import 'dotenv/config';

function num(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: num(process.env.PORT, 4000),
  jwtSecret: process.env.JWT_SECRET ?? 'dev-access-secret-change-me',
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET ?? 'dev-refresh-secret-change-me',
  accessTokenTtl: process.env.ACCESS_TOKEN_TTL ?? '30m',
  refreshTokenDays: num(process.env.REFRESH_TOKEN_DAYS, 30),
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:5173,http://localhost:4173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),

  // market feed
  feedProvider: (process.env.FEED_PROVIDER ?? 'simulated') as 'simulated' | 'binance',
  feedTickMs: num(process.env.FEED_TICK_MS, 250),
  binanceWsUrl: process.env.BINANCE_WS_URL ?? 'wss://stream.binance.com:9443/stream',

  // trading
  settlementIntervalMs: num(process.env.SETTLEMENT_INTERVAL_MS, 200),
  maxOpenTradesPerUser: num(process.env.MAX_OPEN_TRADES, 25),

  // wallet
  minDepositUsd: num(process.env.MIN_DEPOSIT_USD, 10),
  minWithdrawUsd: num(process.env.MIN_WITHDRAW_USD, 20),
  withdrawFeePct: num(process.env.WITHDRAW_FEE_PCT, 1), // percent of gross
  withdrawFlatFeeUsd: num(process.env.WITHDRAW_FLAT_FEE_USD, 1),
  depositWindowMinutes: num(process.env.DEPOSIT_WINDOW_MINUTES, 60),
  // when true a pending deposit is auto-confirmed by the mock chain watcher,
  // which is how the sandbox demonstrates an on-chain credit without a real node
  mockChainWatcher: bool(process.env.MOCK_CHAIN_WATCHER, true),
  mockChainConfirmMs: num(process.env.MOCK_CHAIN_CONFIRM_MS, 20000),
  autoApproveWithdrawals: bool(process.env.AUTO_APPROVE_WITHDRAWALS, false),
} as const;

export type Env = typeof env;
