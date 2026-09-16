import { EventEmitter } from 'node:events';
import type { Tournament, TournamentEntry } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { applyLedger, type TxClient } from './wallet.js';

export const tournamentEvents = new EventEmitter();

/** Prize split "50,30,20" -> [50, 30, 20]; anything malformed means winner-takes-all. */
export function parseSplit(split: string): number[] {
  const parts = split
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  const total = parts.reduce((sum, n) => sum + n, 0);
  return parts.length && total > 0 ? parts : [100];
}

/**
 * Splits `pool` across the leaderboard by percentage, handing any rounding
 * remainder to first place so the payouts always add up to the pool exactly.
 */
export function prizesFor(pool: number, split: string, entrants: number): number[] {
  if (pool <= 0 || entrants <= 0) return [];
  const parts = parseSplit(split).slice(0, entrants);
  const total = parts.reduce((sum, n) => sum + n, 0);
  const prizes = parts.map((part) => Math.floor((pool * part) / total));
  const remainder = pool - prizes.reduce((sum, n) => sum + n, 0);
  if (prizes.length) prizes[0] += remainder;
  return prizes;
}

export async function listTournaments(userId?: string) {
  const tournaments = await prisma.tournament.findMany({
    where: { status: { in: ['SCHEDULED', 'RUNNING', 'FINISHED'] } },
    orderBy: [{ status: 'asc' }, { startsAt: 'asc' }],
    take: 50,
    include: { _count: { select: { entries: true } } },
  });

  const myEntries = userId
    ? await prisma.tournamentEntry.findMany({ where: { userId }, select: { tournamentId: true, balance: true, rank: true, prize: true } })
    : [];

  return tournaments.map((tournament) => {
    const entry = myEntries.find((e) => e.tournamentId === tournament.id);
    return {
      id: tournament.id,
      name: tournament.name,
      description: tournament.description,
      status: tournament.status,
      entryFee: tournament.entryFee,
      prizePool: tournament.prizePool,
      startingBalance: tournament.startingBalance,
      maxEntries: tournament.maxEntries,
      prizeSplit: parseSplit(tournament.prizeSplit),
      startsAt: tournament.startsAt,
      endsAt: tournament.endsAt,
      entrants: tournament._count.entries,
      joined: Boolean(entry),
      myBalance: entry?.balance ?? null,
      myRank: entry?.rank ?? null,
      myPrize: entry?.prize ?? 0,
    };
  });
}

export async function leaderboard(tournamentId: string, limit = 50) {
  const entries = await prisma.tournamentEntry.findMany({
    where: { tournamentId },
    orderBy: [{ balance: 'desc' }, { joinedAt: 'asc' }],
    take: limit,
    include: { user: { select: { name: true } } },
  });
  return entries.map((entry, index) => ({
    id: entry.id,
    userId: entry.userId,
    name: entry.user.name,
    balance: entry.balance,
    startingBalance: entry.startingBalance,
    profit: entry.balance - entry.startingBalance,
    trades: entry.trades,
    wins: entry.wins,
    place: entry.rank ?? index + 1,
    prize: entry.prize,
  }));
}

/** Buys in: charges the entry fee from the real balance and hands out chips. */
export async function joinTournament(userId: string, tournamentId: string): Promise<TournamentEntry> {
  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    include: { _count: { select: { entries: true } } },
  });
  if (!tournament) throw notFound('Tournament not found');
  if (!['SCHEDULED', 'RUNNING'].includes(tournament.status)) throw conflict('This tournament is closed', 'closed');
  if (tournament.endsAt < new Date()) throw conflict('This tournament has already ended', 'closed');
  if (tournament.maxEntries > 0 && tournament._count.entries >= tournament.maxEntries) {
    throw conflict('This tournament is full', 'full');
  }

  const existing = await prisma.tournamentEntry.findUnique({
    where: { tournamentId_userId: { tournamentId, userId } },
  });
  if (existing) throw conflict('You have already joined this tournament', 'already_joined');

  const entry = await prisma.$transaction(async (tx) => {
    if (tournament.entryFee > 0) {
      await applyLedger(tx, {
        userId,
        accountType: 'REAL',
        type: 'TOURNAMENT_ENTRY',
        amount: -tournament.entryFee,
        refType: 'tournament',
        refId: tournament.id,
        note: `Entry fee: ${tournament.name}`,
      });
      // entry fees feed the pot
      await tx.tournament.update({
        where: { id: tournament.id },
        data: { prizePool: { increment: tournament.entryFee } },
      });
    }
    return tx.tournamentEntry.create({
      data: {
        tournamentId,
        userId,
        balance: tournament.startingBalance,
        startingBalance: tournament.startingBalance,
      },
    });
  });

  tournamentEvents.emit('joined', entry);
  return entry;
}

/** The entry a user may trade with right now, if any. */
export async function activeEntry(userId: string, tournamentId?: string) {
  const now = new Date();
  return prisma.tournamentEntry.findFirst({
    where: {
      userId,
      ...(tournamentId ? { tournamentId } : {}),
      tournament: { status: 'RUNNING', startsAt: { lte: now }, endsAt: { gt: now } },
    },
    include: { tournament: true },
  });
}

/** Moves tournament chips. Chips never touch a cash balance. */
export async function adjustEntryBalance(
  tx: TxClient,
  entryId: string,
  delta: number,
  outcome?: 'WON' | 'LOST' | 'REFUNDED',
): Promise<number> {
  const entry = await tx.tournamentEntry.findUnique({ where: { id: entryId } });
  if (!entry) throw notFound('Tournament entry not found');
  const next = entry.balance + delta;
  if (next < 0) throw badRequest('Not enough tournament balance', 'insufficient_funds');

  await tx.tournamentEntry.update({
    where: { id: entryId },
    data: {
      balance: next,
      ...(delta < 0 ? { trades: { increment: 1 } } : {}),
      ...(outcome === 'WON' ? { wins: { increment: 1 } } : {}),
    },
  });
  return next;
}

export async function startTournament(tournamentId: string): Promise<Tournament> {
  const tournament = await prisma.tournament.findUnique({ where: { id: tournamentId } });
  if (!tournament) throw notFound('Tournament not found');
  if (tournament.status !== 'SCHEDULED') throw conflict('Tournament is not scheduled', 'bad_status');
  const updated = await prisma.tournament.update({
    where: { id: tournamentId },
    data: { status: 'RUNNING', startsAt: new Date() },
  });
  tournamentEvents.emit('updated', updated);
  return updated;
}

/**
 * Ranks the final leaderboard and pays the pool out to the real balances.
 * Idempotent: a tournament already FINISHED is returned untouched.
 */
export async function finishTournament(tournamentId: string): Promise<Tournament> {
  const tournament = await prisma.tournament.findUnique({ where: { id: tournamentId } });
  if (!tournament) throw notFound('Tournament not found');
  if (tournament.status === 'FINISHED') return tournament;
  if (tournament.status === 'CANCELLED') throw conflict('Tournament was cancelled', 'bad_status');

  const finished = await prisma.$transaction(async (tx) => {
    const claimed = await tx.tournament.updateMany({
      where: { id: tournamentId, status: { in: ['SCHEDULED', 'RUNNING'] } },
      data: { status: 'FINISHED', finishedAt: new Date(), endsAt: new Date() },
    });
    if (claimed.count === 0) return tx.tournament.findUnique({ where: { id: tournamentId } });

    // any position still open when the clock runs out is refunded in chips
    const openTrades = await tx.trade.findMany({
      where: { entryId: { not: null }, status: 'OPEN', accountType: 'TOURNAMENT' },
      select: { id: true, entryId: true, stake: true, tournamentId: true },
    });
    for (const trade of openTrades.filter((t) => t.tournamentId === tournamentId)) {
      await tx.trade.update({ where: { id: trade.id }, data: { status: 'REFUNDED', settledAt: new Date() } });
      await adjustEntryBalance(tx, trade.entryId!, trade.stake, 'REFUNDED');
    }

    const entries = await tx.tournamentEntry.findMany({
      where: { tournamentId },
      orderBy: [{ balance: 'desc' }, { joinedAt: 'asc' }],
    });
    const prizes = prizesFor(tournament.prizePool, tournament.prizeSplit, entries.length);

    for (const [index, entry] of entries.entries()) {
      const prize = prizes[index] ?? 0;
      await tx.tournamentEntry.update({ where: { id: entry.id }, data: { rank: index + 1, prize } });
      if (prize > 0) {
        await applyLedger(tx, {
          userId: entry.userId,
          accountType: 'REAL',
          type: 'TOURNAMENT_PRIZE',
          amount: prize,
          refType: 'tournament',
          refId: tournamentId,
          note: `Place ${index + 1} in ${tournament.name}`,
        });
      }
    }
    return tx.tournament.findUnique({ where: { id: tournamentId } });
  });

  tournamentEvents.emit('updated', finished);
  return finished as Tournament;
}

/** Closes out tournaments whose clock has run out. */
export async function finishDueTournaments(): Promise<number> {
  const due = await prisma.tournament.findMany({
    where: { status: 'RUNNING', endsAt: { lte: new Date() } },
    select: { id: true },
  });
  for (const tournament of due) await finishTournament(tournament.id);

  const starting = await prisma.tournament.findMany({
    where: { status: 'SCHEDULED', startsAt: { lte: new Date() }, endsAt: { gt: new Date() } },
    select: { id: true },
  });
  for (const tournament of starting) {
    const updated = await prisma.tournament.update({ where: { id: tournament.id }, data: { status: 'RUNNING' } });
    tournamentEvents.emit('updated', updated);
  }
  return due.length;
}
