export interface User {
  id: string;
  email: string;
  name: string;
  country?: string | null;
  role: 'USER' | 'ADMIN';
  status: 'ACTIVE' | 'SUSPENDED';
  activeAccount: AccountType;
  demoBalance: number;
  realBalance: number;
  lockedBalance: number;
  totalDeposited: number;
  totalWithdrawn: number;
  referralCode: string;
  referralEarnings: number;
  kycStatus: 'NOT_SUBMITTED' | 'PENDING' | 'APPROVED' | 'REJECTED';
  /** The saved chart workspace; validated by the reader, so it is unknown here. */
  terminalLayout?: unknown;
  /** The studies on their chart, validated by the terminal that reads them. */
  chartStudies?: unknown;
  /** The marks they have drawn, keyed by market symbol. */
  chartDrawings?: unknown;
  /** Null until they follow the link we emailed them. */
  emailVerifiedAt?: string | null;
  twoFactorEnabled?: boolean;
  /** The trader's status level and the perks it carries. */
  statusLevel?: {
    enabled: boolean;
    id: 'STANDARD' | 'PRO' | 'VIP';
    name: string;
    /** Percentage points added to this trader's payout. */
    payoutBonus: number;
    /** Percentage added to their deposits. */
    depositBonus: number;
  };
  /** The trader's experience level, for the header. */
  experience?: { enabled: boolean; xp: number; level: number; percent: number };
  /** Loyalty points. Never money: they buy marketplace items and nothing else. */
  points?: number;
  /** A payout booster the trader has running, if any. */
  boost?: { bonusPct: number; expiresAt: string } | null;
  /** Set while the trader has excluded themselves. Withdrawals stay open. */
  excludedUntil?: string | null;
  /** A colour from the avatar palette. */
  avatar?: string | null;
  timezone?: string | null;
  language?: string | null;
  /** BCP-47 locale for number formatting. Amounts stay in USD. */
  numberFormat?: string | null;
  notifyPrefs?: Record<string, boolean>;
  createdAt: string;
}

export type AccountType = 'DEMO' | 'REAL' | 'TOURNAMENT';

export interface Tournament {
  id: string;
  name: string;
  description: string | null;
  status: 'SCHEDULED' | 'RUNNING' | 'FINISHED' | 'CANCELLED';
  entryFee: number;
  prizePool: number;
  startingBalance: number;
  maxEntries: number;
  prizeSplit: number[];
  startsAt: string;
  endsAt: string;
  entrants: number;
  joined: boolean;
  myBalance: number | null;
  myRank: number | null;
  myPrize: number;
}

export interface LeaderboardRow {
  id: string;
  userId: string;
  name: string;
  balance: number;
  startingBalance: number;
  profit: number;
  trades: number;
  wins: number;
  place: number;
  prize: number;
}

export interface SupportMessage {
  id: string;
  ticketId: string;
  senderId: string;
  fromSupport: boolean;
  body: string;
  createdAt: string;
}

export interface SupportTicket {
  id: string;
  userId: string;
  subject: string;
  status: 'OPEN' | 'ANSWERED' | 'CLOSED';
  unreadByUser: number;
  unreadByAgent: number;
  lastMessageAt: string;
  createdAt: string;
  messages: SupportMessage[];
  user?: { email: string; name: string; realBalance: number };
}

export type AssetClass = 'CURRENCY' | 'CRYPTO' | 'COMMODITY' | 'STOCK' | 'INDEX';

export interface Asset {
  id: string;
  symbol: string;
  name: string;
  pair: string;
  assetClass: AssetClass;
  isOtc: boolean;
  icon: string | null;
  base: string;
  quote: string;
  pipSize: number;
  payoutPct: number;
  basePayoutPct?: number;
  payoutAdjustments?: { name: string; kind: string; adjustment: number }[];
  /** Durations this market offers, in seconds. */
  durations?: number[];
  /** The share of staked money on each side over the recent window. */
  sentiment?: TraderSentiment | null;
  minStake: number;
  maxStake: number;
  precision: number;
  price: number | null;
  /** `binance`, `httpquotes` or `broker` — shown next to the price. */
  priceSource: string;
  changePct: number;
  isOpen: boolean;
  nextOpen: string | null;
  nextClose: string | null;
  holiday: string | null;
  schedule: { key: string; name: string; hours: string } | null;
  otcAlternative: string | null;
}

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface Trade {
  id: string;
  symbol: string;
  accountType: AccountType;
  direction: 'UP' | 'DOWN';
  stake: number;
  payoutPct: number;
  entryPrice: number;
  exitPrice: number | null;
  currentPrice?: number | null;
  durationSec: number;
  expiryMode?: 'DURATION' | 'CLOCK';
  openedAt: string;
  expiresAt: string;
  settledAt: string | null;
  status: 'OPEN' | 'WON' | 'LOST' | 'REFUNDED';
  profit: number;
  potentialProfit: number;
  tournamentId?: string | null;
}

export interface Transaction {
  id: string;
  accountType: AccountType;
  type: string;
  amount: number;
  balanceAfter: number;
  note: string | null;
  refType: string | null;
  refId: string | null;
  createdAt: string;
}

export interface PaymentMethod {
  currency: string;
  network: string;
  label: string;
  decimals: number;
  confirmations: number;
  minDepositUsd: number;
  minWithdrawUsd: number;
  networkFeeUsd: number;
  rate: number;
  /** False only for a method that can never pay out — a card cannot receive
   *  an arbitrary payout, only refund a charge it captured. */
  payoutSupported: boolean;
}

export interface Deposit {
  id: string;
  currency: string;
  network: string;
  /** Which PaymentProvider this went through: CRYPTO, CARD or EWALLET. */
  provider: string;
  networkLabel: string;
  address: string;
  cryptoAmount: string;
  rate: number;
  creditedAmount: number;
  promoCode: string | null;
  bonusAmount: number;
  txHash: string | null;
  explorerUrl: string | null;
  confirmations: number;
  requiredConf: number;
  status: 'AWAITING_PAYMENT' | 'CONFIRMING' | 'COMPLETED' | 'REJECTED' | 'EXPIRED';
  expiresAt: string;
  confirmedAt: string | null;
  createdAt: string;
  user?: { email: string; name: string };
}

export interface Withdrawal {
  id: string;
  currency: string;
  network: string;
  /** Which PaymentProvider this went through: CRYPTO or EWALLET. */
  provider: string;
  networkLabel: string;
  address: string;
  amount: number;
  fee: number;
  netAmount: number;
  rate: number;
  cryptoAmount: string;
  status: 'PENDING' | 'APPROVED' | 'PROCESSING' | 'COMPLETED' | 'REJECTED' | 'CANCELLED';
  txHash: string | null;
  explorerUrl: string | null;
  adminNote: string | null;
  processedAt: string | null;
  createdAt: string;
  user?: { email: string; name: string; totalDeposited: number };
}

export interface WithdrawalQuote {
  currency: string;
  network: string;
  amount: number;
  fee: number;
  netAmount: number;
  rate: number;
  cryptoAmount: string;
  minAmount: number;
}

export interface TradingStats {
  total: number;
  wins: number;
  losses: number;
  refunded: number;
  winRate: number;
  netProfit: number;
  volume: number;
}

export interface Balances {
  demoBalance: number;
  realBalance: number;
  lockedBalance: number;
  activeAccount: AccountType;
}

/** One buyable clock boundary, as the server resolved it. */
export interface ClockSlot {
  expiresAt: number;
  stepSec: number;
  closesAt: number;
  secondsToClose: number;
  durationSec: number;
}

export interface ExpiryConfig {
  modes: ('DURATION' | 'CLOCK')[];
  clock: { steps: number[]; cutoffSec: number; horizonSec: number; slots: ClockSlot[] };
}

/** An order waiting on a price level or a time. */
export interface PendingOrder {
  id: string;
  symbol: string;
  accountType: AccountType;
  direction: 'UP' | 'DOWN';
  stake: number;
  trigger: 'PRICE' | 'TIME';
  triggerPrice: number | null;
  triggerSide: 'ABOVE' | 'BELOW' | null;
  triggerAt: string | null;
  expiryMode: 'DURATION' | 'CLOCK';
  durationSec: number | null;
  expiresAt: string | null;
  status: 'PENDING' | 'TRIGGERED' | 'CANCELLED' | 'EXPIRED' | 'FAILED';
  goodUntil: string;
  tradeId: string | null;
  failureReason: string | null;
  triggeredAt: string | null;
  createdAt: string;
  tournamentId: string | null;
}

/** How the ticket's stake controls behave, in cents. */
export interface TicketConfig {
  presets: number[];
  step: number;
  allowRepeat: boolean;
  /** The platform switch; a trader may still turn them off for themselves. */
  hotkeys: boolean;
}

/** Trader sentiment on one market: a display of aggregate positions. */
export interface TraderSentiment {
  upPct: number;
  downPct: number;
  trades: number;
  stake: number;
  meaningful: boolean;
}
