import { prisma } from '../lib/prisma.js';
import type { Prisma } from '@prisma/client';
import { settings } from './settings.js';
import { allowance, checkRisk, type RiskLimits, type RiskRejection } from '../engine/risk.js';

/**
 * Live exposure and the limits that cap it.
 *
 * Exposure is the sum of open stakes, which is what the house holds against a
 * market. Only live-money positions count: practice and tournament balances are
 * not the house's money, and a practice trader must never be turned away
 * because real traders filled a book.
 *
 * Nothing in here can change a price, a payout or an outcome. It only ever
 * answers "may this new stake be accepted?".
 */

export interface AssetRiskConfig {
  minStake: number;
  maxStake: number;
  maxOpenStakePerUser: number;
  maxExposurePerDirection: number;
}

/**
 * Fills a market's zeroes in from the runtime defaults, and clamps its own
 * stake bounds to the platform-wide ones: a market's minimum can only ever be
 * stricter (higher) than the platform floor, and its maximum only stricter
 * (lower) than the platform ceiling — an operator tightening the platform
 * setting takes effect on every market at once, without editing each one.
 */
export function limitsFor(asset: AssetRiskConfig): RiskLimits {
  return {
    minStake: Math.max(asset.minStake, settings.get('trading.minStakeCents')),
    maxStake: Math.min(asset.maxStake, settings.get('trading.maxStakeCents')),
    maxOpenStakePerUser:
      asset.maxOpenStakePerUser > 0 ? asset.maxOpenStakePerUser : settings.get('risk.maxOpenStakePerUser'),
    maxExposurePerDirection:
      asset.maxExposurePerDirection > 0
        ? asset.maxExposurePerDirection
        : settings.get('risk.maxExposurePerDirection'),
  };
}

/** Whether this account's positions count against the house's book. */
export function countsTowardHouse(accountType: string): boolean {
  return accountType === 'REAL';
}

export interface RiskProbe {
  assetId: string;
  userId: string;
  accountType: string;
  direction: 'UP' | 'DOWN';
}

/**
 * What is already open, for the two aggregates the limits need.
 *
 * Takes a transaction client so the read and the position's creation happen in
 * one transaction: two simultaneous trades can still overshoot a house limit by
 * at most one stake, which is a cost worth paying over serialising every trade
 * on the whole market.
 */
export async function openStakes(
  client: Prisma.TransactionClient | typeof prisma,
  probe: RiskProbe,
): Promise<{ userOpenStake: number; directionExposure: number }> {
  const [mine, house] = await Promise.all([
    client.trade.aggregate({
      _sum: { stake: true },
      where: {
        userId: probe.userId,
        assetId: probe.assetId,
        accountType: probe.accountType,
        status: 'OPEN',
      },
    }),
    countsTowardHouse(probe.accountType)
      ? client.trade.aggregate({
          _sum: { stake: true },
          where: {
            assetId: probe.assetId,
            direction: probe.direction,
            accountType: 'REAL',
            status: 'OPEN',
          },
        })
      : Promise.resolve({ _sum: { stake: null } }),
  ]);

  return {
    userOpenStake: mine._sum.stake ?? 0,
    directionExposure: house._sum.stake ?? 0,
  };
}

/** Null when the stake is allowed, a rejection with a clear message otherwise. */
export async function assessStake(
  client: Prisma.TransactionClient | typeof prisma,
  input: RiskProbe & { stake: number; asset: AssetRiskConfig },
): Promise<RiskRejection | null> {
  const limits = limitsFor(input.asset);
  const state = await openStakes(client, input);
  return checkRisk({ stake: input.stake, limits, state });
}

export interface MarketExposure {
  assetId: string;
  symbol: string;
  pair: string;
  assetClass: string;
  payoutPct: number;
  limits: RiskLimits;
  up: number;
  down: number;
  net: number;
  openPositions: number;
  traders: number;
  /** Worst case the house pays if every open position on a side wins, in cents. */
  liabilityUp: number;
  liabilityDown: number;
  /** How full the tighter side is, 0–1; null when the market has no cap. */
  utilisation: number | null;
  /** Room left for one more position on each side, in cents. */
  roomUp: number | null;
  roomDown: number | null;
}

/**
 * Live exposure per market for the back office, live money only.
 *
 * One grouped query rather than one per market: this is read on an interval by
 * an open admin screen.
 */
export async function exposureByMarket(): Promise<MarketExposure[]> {
  const [assets, grouped, traderCounts] = await Promise.all([
    prisma.asset.findMany({
      where: { enabled: true },
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true,
        symbol: true,
        pair: true,
        assetClass: true,
        payoutPct: true,
        minStake: true,
        maxStake: true,
        maxOpenStakePerUser: true,
        maxExposurePerDirection: true,
      },
    }),
    prisma.trade.groupBy({
      by: ['assetId', 'direction'],
      where: { status: 'OPEN', accountType: 'REAL' },
      _sum: { stake: true },
      _count: { _all: true },
    }),
    prisma.trade.findMany({
      where: { status: 'OPEN', accountType: 'REAL' },
      distinct: ['assetId', 'userId'],
      select: { assetId: true },
    }),
  ]);

  const tradersPerAsset = new Map<string, number>();
  for (const row of traderCounts) {
    tradersPerAsset.set(row.assetId, (tradersPerAsset.get(row.assetId) ?? 0) + 1);
  }

  const sums = new Map<string, { stake: number; count: number }>();
  for (const row of grouped) {
    sums.set(`${row.assetId}|${row.direction}`, {
      stake: row._sum.stake ?? 0,
      count: row._count._all,
    });
  }

  return assets.map((asset) => {
    const up = sums.get(`${asset.id}|UP`) ?? { stake: 0, count: 0 };
    const down = sums.get(`${asset.id}|DOWN`) ?? { stake: 0, count: 0 };
    const limits = limitsFor(asset);
    const cap = limits.maxExposurePerDirection;
    const room = (side: number) => (cap > 0 ? Math.max(cap - side, 0) : null);
    // a winning position returns the stake plus the payout; the stake is
    // already the trader's, so the house's exposure is the payout itself
    const liability = (stake: number) => Math.floor((stake * asset.payoutPct) / 100);

    return {
      assetId: asset.id,
      symbol: asset.symbol,
      pair: asset.pair,
      assetClass: asset.assetClass,
      payoutPct: asset.payoutPct,
      limits,
      up: up.stake,
      down: down.stake,
      net: up.stake - down.stake,
      openPositions: up.count + down.count,
      traders: tradersPerAsset.get(asset.id) ?? 0,
      liabilityUp: liability(up.stake),
      liabilityDown: liability(down.stake),
      utilisation: cap > 0 ? Math.min(Math.max(up.stake, down.stake) / cap, 1) : null,
      roomUp: room(up.stake),
      roomDown: room(down.stake),
    };
  });
}

export { allowance, checkRisk };
