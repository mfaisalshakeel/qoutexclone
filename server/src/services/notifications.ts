import { EventEmitter } from 'node:events';
import type { Deposit, Notification, Trade, Withdrawal } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { log } from '../lib/logger.js';
import { settings } from './settings.js';
import { tradeEvents } from './trading.js';
import { depositEvents } from './deposits.js';
import { withdrawalEvents } from './withdrawals.js';
import { supportEvents } from './support.js';
import { tournamentEvents } from './tournaments.js';
import {
  depositCredited,
  supportReply,
  tournamentFinished,
  tournamentStarted,
  tradeSettled,
  withdrawalUpdated,
  type NotificationDraft,
} from '../engine/notifications.js';

export const notificationEvents = new EventEmitter();

const PAGE = 20;
const MAX_PAGE = 50;
const PRUNE_MS = 6 * 3_600_000;

/**
 * The notification centre.
 *
 * Nothing here is in the path of a payment or a settlement: the service listens
 * to the events those flows already emit and writes its own rows afterwards. A
 * notification that cannot be written must never cost a trader their payout, so
 * every failure is logged and swallowed.
 *
 * Writing is idempotent on the event's natural key, so a retried webhook, two
 * sweepers racing or a restart mid-write leaves exactly one line.
 */

/** Pairs for the wording. They change about never, so one lookup each is plenty. */
const pairs = new Map<string, string>();

async function pairFor(symbol: string): Promise<string | null> {
  const known = pairs.get(symbol);
  if (known) return known;
  const asset = await prisma.asset.findUnique({ where: { symbol }, select: { pair: true } });
  if (asset?.pair) pairs.set(symbol, asset.pair);
  return asset?.pair ?? null;
}

export async function notify(userId: string, draft: NotificationDraft): Promise<Notification | null> {
  if (!settings.get('notifications.enabled')) return null;

  try {
    // `skipDuplicates` rather than catching the unique violation: a retry is
    // ordinary traffic, and letting the database raise on it would fill the
    // logs with errors that are not faults
    const written = await prisma.notification.createMany({
      data: [
        {
          userId,
          kind: draft.kind,
          title: draft.title,
          body: draft.body,
          href: draft.href,
          dedupeKey: draft.key,
        },
      ],
      skipDuplicates: true,
    });
    if (written.count === 0) return null;

    const row = await prisma.notification.findFirst({ where: { userId, dedupeKey: draft.key } });
    if (row) notificationEvents.emit('created', row);
    return row;
  } catch (err) {
    log.notify.error({ err, userId, kind: draft.kind }, 'could not write a notification');
    return null;
  }
}

export interface Page {
  items: Notification[];
  unread: number;
  /** `createdAt` of the last item, for the next page. */
  cursor: string | null;
}

export async function list(
  userId: string,
  options: { limit?: number; before?: Date; unreadOnly?: boolean } = {},
): Promise<Page> {
  const limit = Math.min(Math.max(options.limit ?? PAGE, 1), MAX_PAGE);
  const items = await prisma.notification.findMany({
    where: {
      userId,
      ...(options.unreadOnly ? { readAt: null } : {}),
      ...(options.before ? { createdAt: { lt: options.before } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  const unread = await prisma.notification.count({ where: { userId, readAt: null } });

  return {
    items,
    unread,
    // a full page means there may be more; a short one is the end
    cursor: items.length === limit ? (items.at(-1)?.createdAt.toISOString() ?? null) : null,
  };
}

export async function unreadCount(userId: string): Promise<number> {
  return prisma.notification.count({ where: { userId, readAt: null } });
}

/**
 * Marks notifications read.
 *
 * Scoped to the owner on every path: an id from another trader's centre matches
 * nothing rather than being marked.
 */
export async function markRead(userId: string, ids?: string[]): Promise<number> {
  const result = await prisma.notification.updateMany({
    where: { userId, readAt: null, ...(ids?.length ? { id: { in: ids } } : {}) },
    data: { readAt: new Date() },
  });
  return result.count;
}

export async function remove(userId: string, id: string): Promise<boolean> {
  const result = await prisma.notification.deleteMany({ where: { userId, id } });
  return result.count > 0;
}

/** Drops notifications past the retention the operator set. */
export async function prune(): Promise<number> {
  const days = settings.get('notifications.retentionDays');
  const cutoff = new Date(Date.now() - days * 86_400_000);
  const result = await prisma.notification.deleteMany({ where: { createdAt: { lt: cutoff } } });
  if (result.count > 0) log.notify.info({ removed: result.count, days }, 'pruned old notifications');
  return result.count;
}

let pruneTimer: NodeJS.Timeout | null = null;
let listening = false;

/**
 * Attaches the listeners once.
 *
 * Idempotent, because the integration tests import this module alongside the
 * services it listens to and a second set of listeners would write every
 * notification twice.
 */
export function startNotifications(): void {
  if (pruneTimer) return;
  pruneTimer = setInterval(() => void prune(), PRUNE_MS);
  pruneTimer.unref?.();
  void prune();
  attach();
}

export function stopNotifications(): void {
  if (pruneTimer) clearInterval(pruneTimer);
  pruneTimer = null;
}

export function attach(): void {
  if (listening) return;
  listening = true;

  // the payloads are typed here, because an event emitter hands them over as
  // `any` and a wrong field name would otherwise reach a trader as "$NaN"
  tradeEvents.on('settled', ({ trade }: { trade: Trade }) => {
    void (async () => {
      const draft = tradeSettled(
        { ...trade, pair: await pairFor(trade.symbol) },
        { practiceResults: settings.get('notifications.practiceResults') },
      );
      if (draft) await notify(trade.userId, draft);
    })();
  });

  depositEvents.on('updated', (deposit: Deposit | null) => {
    if (!deposit || deposit.status !== 'COMPLETED') return;
    void notify(deposit.userId, depositCredited(deposit));
  });

  withdrawalEvents.on('updated', (withdrawal: Withdrawal | null) => {
    if (!withdrawal) return;
    const draft = withdrawalUpdated(withdrawal);
    if (draft) void notify(withdrawal.userId, draft);
  });

  supportEvents.on(
    'message',
    ({
      message,
      userId,
      subject,
    }: {
      message: { id: string; body: string; fromSupport: boolean };
      userId: string;
      subject: string;
    }) => {
      // only the desk's replies are news; the trader wrote the rest themselves
      if (!message.fromSupport) return;
      void notify(userId, supportReply({ ...message, subject }));
    },
  );

  tournamentEvents.on('started', (tournament: { id: string; name: string } | null) => {
    if (tournament) void tellEntrants(tournament, 'started');
  });
  tournamentEvents.on('finished', (tournament: { id: string; name: string } | null) => {
    if (tournament) void tellEntrants(tournament, 'finished');
  });
}

async function tellEntrants(
  tournament: { id: string; name: string },
  phase: 'started' | 'finished',
): Promise<void> {
  try {
    const entries = await prisma.tournamentEntry.findMany({
      where: { tournamentId: tournament.id },
      select: { userId: true, rank: true, prize: true },
    });
    for (const entry of entries) {
      await notify(
        entry.userId,
        phase === 'started' ? tournamentStarted(tournament) : tournamentFinished(tournament, entry),
      );
    }
  } catch (err) {
    log.notify.error({ err, tournamentId: tournament.id }, 'could not notify tournament entrants');
  }
}
