import type { Deposit, Trade, Transaction, User, Withdrawal } from '@prisma/client';
import { findNetwork } from './crypto-networks.js';

export function publicUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    country: user.country,
    role: user.role,
    status: user.status,
    activeAccount: user.activeAccount,
    demoBalance: user.demoBalance,
    realBalance: user.realBalance,
    lockedBalance: user.lockedBalance,
    totalDeposited: user.totalDeposited,
    totalWithdrawn: user.totalWithdrawn,
    referralCode: user.referralCode,
    createdAt: user.createdAt,
  };
}

export function publicTrade(trade: Trade) {
  return {
    id: trade.id,
    symbol: trade.symbol,
    accountType: trade.accountType,
    direction: trade.direction,
    stake: trade.stake,
    payoutPct: trade.payoutPct,
    entryPrice: trade.entryPrice,
    exitPrice: trade.exitPrice,
    durationSec: trade.durationSec,
    openedAt: trade.openedAt,
    expiresAt: trade.expiresAt,
    settledAt: trade.settledAt,
    status: trade.status,
    profit: trade.profit,
    potentialProfit: Math.floor((trade.stake * trade.payoutPct) / 100),
  };
}

export function publicTransaction(tx: Transaction) {
  return {
    id: tx.id,
    accountType: tx.accountType,
    type: tx.type,
    amount: tx.amount,
    balanceAfter: tx.balanceAfter,
    note: tx.note,
    refType: tx.refType,
    refId: tx.refId,
    createdAt: tx.createdAt,
  };
}

export function publicDeposit(deposit: Deposit) {
  const spec = findNetwork(deposit.currency, deposit.network);
  return {
    id: deposit.id,
    currency: deposit.currency,
    network: deposit.network,
    networkLabel: spec?.label ?? deposit.network,
    address: deposit.address,
    cryptoAmount: deposit.cryptoAmount,
    rate: deposit.rate,
    creditedAmount: deposit.creditedAmount,
    txHash: deposit.txHash,
    explorerUrl: deposit.txHash && spec ? `${spec.explorerTx}${deposit.txHash}` : null,
    confirmations: deposit.confirmations,
    requiredConf: deposit.requiredConf,
    status: deposit.status,
    expiresAt: deposit.expiresAt,
    confirmedAt: deposit.confirmedAt,
    createdAt: deposit.createdAt,
  };
}

export function publicWithdrawal(withdrawal: Withdrawal) {
  const spec = findNetwork(withdrawal.currency, withdrawal.network);
  return {
    id: withdrawal.id,
    currency: withdrawal.currency,
    network: withdrawal.network,
    networkLabel: spec?.label ?? withdrawal.network,
    address: withdrawal.address,
    amount: withdrawal.amount,
    fee: withdrawal.fee,
    netAmount: withdrawal.netAmount,
    rate: withdrawal.rate,
    cryptoAmount: withdrawal.cryptoAmount,
    status: withdrawal.status,
    txHash: withdrawal.txHash,
    explorerUrl: withdrawal.txHash && spec ? `${spec.explorerTx}${withdrawal.txHash}` : null,
    adminNote: withdrawal.adminNote,
    processedAt: withdrawal.processedAt,
    createdAt: withdrawal.createdAt,
  };
}
