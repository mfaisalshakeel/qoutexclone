import { prisma } from '../lib/prisma.js';
import { firstTimeDepositors } from './admin-stats.js';
import { exposureByMarket } from './risk.js';

/**
 * The admin dashboard's charts.
 *
 * Separate from the period KPIs on purpose: those answer "how did this
 * window compare to the one before it", these answer "what does the trend
 * look like" — a trailing N-day series, bucketed by UTC calendar day, rather
 * than a single comparison. Exposure is the exception: it is a live read of
 * the risk book right now, not a history, and reuses `exposureByMarket`
 * (already built for the Risk screen) rather than a second copy of it.
 */

export interface DailyPoint {
  date: string; // YYYY-MM-DD, UTC
  depositVolume: number;
  withdrawalVolume: number;
  housePnl: number;
}

export interface ChartsPayload {
  days: number;
  series: DailyPoint[];
  funnel: { registrations: number; firstTimeDepositors: number };
  volumeByAssetClass: { assetClass: string; volume: number }[];
  topAssets: { symbol: string; pair: string; volume: number }[];
  exposure: { symbol: string; up: number; down: number }[];
  /** 7 rows (UTC weekday, 0=Sunday) x 24 columns (UTC hour), counts of trades opened. */
  hourlyActivity: number[][];
}

const dayKey = (d: Date) => d.toISOString().slice(0, 10);

function emptyDaily(days: number, to: Date): Map<string, DailyPoint> {
  const map = new Map<string, DailyPoint>();
  for (let i = 0; i < days; i += 1) {
    const d = new Date(to.getTime() - i * 86_400_000);
    map.set(dayKey(d), { date: dayKey(d), depositVolume: 0, withdrawalVolume: 0, housePnl: 0 });
  }
  return map;
}

export async function dashboardCharts(days: number): Promise<ChartsPayload> {
  const to = new Date();
  const from = new Date(to.getTime() - days * 86_400_000);

  const [deposits, withdrawals, trades, assets, topAssetAgg, exposure, registrations, ftd] = await Promise.all([
    prisma.deposit.findMany({
      where: { status: 'COMPLETED', confirmedAt: { gte: from, lt: to } },
      select: { confirmedAt: true, creditedAmount: true },
    }),
    prisma.withdrawal.findMany({
      where: { status: 'COMPLETED', processedAt: { gte: from, lt: to } },
      select: { processedAt: true, amount: true },
    }),
    prisma.trade.findMany({
      where: { accountType: 'REAL', status: { in: ['WON', 'LOST'] }, settledAt: { gte: from, lt: to } },
      select: { settledAt: true, profit: true, stake: true, assetId: true, openedAt: true },
    }),
    prisma.asset.findMany({ select: { id: true, symbol: true, pair: true, assetClass: true } }),
    prisma.trade.groupBy({
      by: ['assetId'],
      where: { accountType: 'REAL', status: { in: ['WON', 'LOST'] }, settledAt: { gte: from, lt: to } },
      _sum: { stake: true },
      orderBy: { _sum: { stake: 'desc' } },
      take: 10,
    }),
    exposureByMarket(),
    prisma.user.count({ where: { createdAt: { gte: from, lt: to } } }),
    firstTimeDepositors(from, to),
  ]);

  const byDay = emptyDaily(days, to);
  for (const d of deposits) {
    const key = dayKey(d.confirmedAt!);
    const bucket = byDay.get(key);
    if (bucket) bucket.depositVolume += d.creditedAmount;
  }
  for (const w of withdrawals) {
    const key = dayKey(w.processedAt!);
    const bucket = byDay.get(key);
    if (bucket) bucket.withdrawalVolume += w.amount;
  }
  for (const t of trades) {
    const key = dayKey(t.settledAt!);
    const bucket = byDay.get(key);
    if (bucket) bucket.housePnl += -t.profit;
  }
  const series = [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));

  const assetById = new Map(assets.map((a) => [a.id, a]));
  const byClass = new Map<string, number>();
  for (const t of trades) {
    const assetClass = assetById.get(t.assetId)?.assetClass ?? 'UNKNOWN';
    byClass.set(assetClass, (byClass.get(assetClass) ?? 0) + t.stake);
  }
  const volumeByAssetClass = [...byClass.entries()]
    .map(([assetClass, volume]) => ({ assetClass, volume }))
    .sort((a, b) => b.volume - a.volume);

  const topAssets = topAssetAgg
    .map((row) => {
      const asset = assetById.get(row.assetId);
      return { symbol: asset?.symbol ?? row.assetId, pair: asset?.pair ?? '', volume: row._sum.stake ?? 0 };
    })
    .filter((row) => row.volume > 0);

  // 7 rows (UTC weekday) x 24 columns (UTC hour). Reuses the same settled-trade
  // set as the P&L series rather than a second query for "opened in window" —
  // a position's open and settle times are minutes apart at most on this
  // platform, so the pattern this draws is the same either way.
  const hourlyActivity = Array.from({ length: 7 }, () => Array(24).fill(0) as number[]);
  for (const t of trades) {
    hourlyActivity[t.openedAt.getUTCDay()][t.openedAt.getUTCHours()] += 1;
  }

  return {
    days,
    series,
    funnel: { registrations, firstTimeDepositors: ftd },
    volumeByAssetClass,
    topAssets,
    exposure: exposure
      .filter((m) => m.up > 0 || m.down > 0)
      .sort((a, b) => b.up + b.down - (a.up + a.down))
      .slice(0, 10)
      .map((m) => ({ symbol: m.symbol, up: m.up, down: m.down })),
    hourlyActivity,
  };
}
