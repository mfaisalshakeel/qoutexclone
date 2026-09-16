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
  createdAt: string;
}

export type AccountType = 'DEMO' | 'REAL';

export interface Asset {
  id: string;
  symbol: string;
  name: string;
  base: string;
  quote: string;
  payoutPct: number;
  minStake: number;
  maxStake: number;
  precision: number;
  price: number | null;
  changePct: number;
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
  openedAt: string;
  expiresAt: string;
  settledAt: string | null;
  status: 'OPEN' | 'WON' | 'LOST' | 'REFUNDED';
  profit: number;
  potentialProfit: number;
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
}

export interface Deposit {
  id: string;
  currency: string;
  network: string;
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
