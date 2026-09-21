import { prisma } from '../lib/prisma.js';
import { badRequest } from '../lib/errors.js';
import { startOfDay } from './responsible.js';

/**
 * The admin dashboard's period-aware KPIs.
 *
 * A period is compared against the immediately preceding period of the same
 * length — "this week" against "last week", a custom 11-day range against the
 * 11 days before it — so the comparison is always apples to apples rather
 * than, say, a partial week against a full one.
 *
 * Only flow metrics (things that happen *within* a window) get a comparison.
 * A queue depth — pending withdrawals, open tickets — is a snapshot of right
 * now, not something that happened during the period, so it has no
 * "previous period" analogue and is reported once, unscoped.
 */

export interface PeriodStats {
  registrations: number;
  firstTimeDepositors: number;
  depositVolume: number;
  withdrawalVolume: number;
  netFlow: number;
  realVolume: number;
  housePnl: number;
  bonusPaid: number;
  activeTraders: number;
  averageStake: number;
  /** 0-100, of settled real-account trades that won. Null when none settled. */
  winRatePct: number | null;
}

export interface DashboardOverview {
  period: { from: string; to: string };
  current: PeriodStats;
  previous: PeriodStats;
  snapshot: {
    users: number;
    openTrades: number;
    pendingDeposits: number;
    pendingWithdrawals: number;
    pendingKyc: number;
    openTickets: number;
    liveTournaments: number;
  };
}

/**
 * Traders whose *first ever* completed deposit falls inside this window.
 *
 * A user who deposited before `from` is a repeat depositor even if they also
 * deposit again during the window, so this is two lookups rather than one:
 * who deposited in the window, then which of those never had a completed
 * deposit before it.
 */
async function firstTimeDepositors(from: Date, to: Date): Promise<number> {
  const inWindow = await prisma.deposit.groupBy({
    by: ['userId'],
    where: { status: 'COMPLETED', confirmedAt: { gte: from, lt: to } },
  });
  if (inWindow.length === 0) return 0;

  const withEarlierDeposit = await prisma.deposit.groupBy({
    by: ['userId'],
    where: {
      status: 'COMPLETED',
      userId: { in: inWindow.map((row) => row.userId) },
      confirmedAt: { lt: from },
    },
  });
  const repeatUserIds = new Set(withEarlierDeposit.map((row) => row.userId));
  return inWindow.filter((row) => !repeatUserIds.has(row.userId)).length;
}

async function periodStats(from: Date, to: Date): Promise<PeriodStats> {
  const [registrations, ftd, depositAgg, withdrawalAgg, tradeAgg, activeTraders, settledByStatus, bonusAgg] =
    await Promise.all([
      prisma.user.count({ where: { createdAt: { gte: from, lt: to } } }),
      firstTimeDepositors(from, to),
      prisma.deposit.aggregate({
        _sum: { creditedAmount: true },
        where: { status: 'COMPLETED', confirmedAt: { gte: from, lt: to } },
      }),
      prisma.withdrawal.aggregate({
        _sum: { amount: true },
        where: { status: 'COMPLETED', processedAt: { gte: from, lt: to } },
      }),
      prisma.trade.aggregate({
        _sum: { stake: true, profit: true },
        _avg: { stake: true },
        where: { accountType: 'REAL', status: { in: ['WON', 'LOST'] }, settledAt: { gte: from, lt: to } },
      }),
      prisma.trade.groupBy({
        by: ['userId'],
        where: { accountType: 'REAL', openedAt: { gte: from, lt: to } },
      }),
      prisma.trade.groupBy({
        by: ['status'],
        where: { accountType: 'REAL', status: { in: ['WON', 'LOST'] }, settledAt: { gte: from, lt: to } },
        _count: true,
      }),
      prisma.promoRedemption.aggregate({
        _sum: { amount: true },
        where: { createdAt: { gte: from, lt: to } },
      }),
    ]);

  const depositVolume = depositAgg._sum.creditedAmount ?? 0;
  const withdrawalVolume = withdrawalAgg._sum.amount ?? 0;
  const won = settledByStatus.find((row) => row.status === 'WON')?._count ?? 0;
  const lost = settledByStatus.find((row) => row.status === 'LOST')?._count ?? 0;
  const settled = won + lost;

  return {
    registrations,
    firstTimeDepositors: ftd,
    depositVolume,
    withdrawalVolume,
    netFlow: depositVolume - withdrawalVolume,
    realVolume: tradeAgg._sum.stake ?? 0,
    // house result is the inverse of trader P&L
    housePnl: -(tradeAgg._sum.profit ?? 0),
    bonusPaid: bonusAgg._sum.amount ?? 0,
    activeTraders: activeTraders.length,
    averageStake: Math.round(tradeAgg._avg.stake ?? 0),
    winRatePct: settled === 0 ? null : Math.round((won / settled) * 1000) / 10,
  };
}

export async function dashboardOverview(range: { from?: Date; to?: Date }): Promise<DashboardOverview> {
  const to = range.to ?? new Date();
  // no start given: default to today (UTC), the same calendar-day definition
  // the responsible-trading and withdrawal daily caps already use
  const from = range.from ?? startOfDay(to);
  if (from >= to) throw badRequest('The start date must be before the end date', 'invalid_range');

  const spanMs = to.getTime() - from.getTime();
  const previousTo = from;
  const previousFrom = new Date(from.getTime() - spanMs);

  const [current, previous, snapshotCounts] = await Promise.all([
    periodStats(from, to),
    periodStats(previousFrom, previousTo),
    Promise.all([
      prisma.user.count(),
      prisma.trade.count({ where: { status: 'OPEN' } }),
      prisma.deposit.count({ where: { status: { in: ['AWAITING_PAYMENT', 'CONFIRMING'] } } }),
      prisma.withdrawal.count({ where: { status: 'PENDING' } }),
      prisma.kycSubmission.count({ where: { status: 'PENDING' } }),
      prisma.supportTicket.count({ where: { unreadByAgent: { gt: 0 } } }),
      prisma.tournament.count({ where: { status: 'RUNNING' } }),
    ]),
  ]);
  const [users, openTrades, pendingDeposits, pendingWithdrawals, pendingKyc, openTickets, liveTournaments] =
    snapshotCounts;

  return {
    period: { from: from.toISOString(), to: to.toISOString() },
    current,
    previous,
    snapshot: {
      users,
      openTrades,
      pendingDeposits,
      pendingWithdrawals,
      pendingKyc,
      openTickets,
      liveTournaments,
    },
  };
}
