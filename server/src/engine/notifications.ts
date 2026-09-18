/**
 * What a notification says.
 *
 * Pure: every event the platform can tell a trader about is turned into a
 * title, a body, a destination and a natural key here, with no database and no
 * clock. That keeps the wording under test — a notification is one of the few
 * things a trader reads when they are not looking at the screen it came from,
 * so "you won" had better never appear on a loss.
 *
 * The `key` is the natural key of the event itself. The store makes it unique
 * per trader, so a retried webhook, a second sweeper or a restart mid-write
 * can only ever produce one notification for the same thing.
 */

export type NotificationKind = 'TRADE' | 'DEPOSIT' | 'WITHDRAWAL' | 'TOURNAMENT' | 'SUPPORT' | 'SYSTEM';

export interface NotificationDraft {
  kind: NotificationKind;
  title: string;
  body: string;
  /** Where the notification takes the reader, or null if there is nowhere to go. */
  href: string | null;
  key: string;
}

/** Cents as money, for reading rather than for arithmetic. */
function money(cents: number): string {
  const sign = cents < 0 ? '−' : '';
  const absolute = Math.abs(cents);
  return `${sign}$${(absolute / 100).toFixed(2)}`;
}

export interface SettledTrade {
  id: string;
  symbol: string;
  pair?: string | null;
  direction: 'UP' | 'DOWN' | string;
  status: string;
  stake: number;
  profit: number;
  accountType: string;
}

/**
 * A settled position.
 *
 * Practice results are left out unless an operator asks for them: a practice
 * trader can take a five-second position every five seconds, and a centre that
 * fills with them is one nobody reads. Tournament and live results are always
 * worth a line.
 */
export function tradeSettled(
  trade: SettledTrade,
  options: { practiceResults?: boolean } = {},
): NotificationDraft | null {
  if (trade.accountType === 'DEMO' && !options.practiceResults) return null;

  const market = trade.pair || trade.symbol;
  const side = trade.direction === 'UP' ? 'Higher' : 'Lower';
  const chips = trade.accountType === 'TOURNAMENT';
  const where = chips ? ' in the tournament' : trade.accountType === 'DEMO' ? ' on practice' : '';

  const key = `trade:${trade.id}:settled`;
  const href = chips ? '/tournaments' : '/history';

  if (trade.status === 'WON')
    return {
      kind: 'TRADE',
      title: `${market} ${side} won`,
      body: `Your ${money(trade.stake)} position${where} returned ${money(trade.stake + trade.profit)} — a profit of ${money(trade.profit)}.`,
      href,
      key,
    };

  if (trade.status === 'REFUNDED')
    return {
      kind: 'TRADE',
      title: `${market} ${side} refunded`,
      body: `The price closed exactly where it opened, so your ${money(trade.stake)} stake${where} was returned in full.`,
      href,
      key,
    };

  return {
    kind: 'TRADE',
    title: `${market} ${side} lost`,
    body: `Your ${money(trade.stake)} position${where} closed against you.`,
    href,
    key,
  };
}

export function depositCredited(deposit: {
  id: string;
  /** Cents credited to the live balance, before any bonus. */
  creditedAmount: number;
  bonusAmount?: number;
  currency: string;
}): NotificationDraft {
  const bonus = deposit.bonusAmount ?? 0;
  return {
    kind: 'DEPOSIT',
    title: 'Deposit credited',
    body:
      bonus > 0
        ? `${money(deposit.creditedAmount)} in ${deposit.currency} has landed in your live balance, with a ${money(bonus)} bonus on top.`
        : `${money(deposit.creditedAmount)} in ${deposit.currency} has landed in your live balance.`,
    href: '/wallet',
    key: `deposit:${deposit.id}:credited`,
  };
}

export function withdrawalUpdated(withdrawal: {
  id: string;
  /** Gross cents debited from the balance. */
  amount: number;
  /** Cents actually sent, after the fee. */
  netAmount: number;
  cryptoAmount?: string | null;
  status: string;
  currency: string;
}): NotificationDraft | null {
  switch (withdrawal.status) {
    case 'COMPLETED': {
      const sent = withdrawal.cryptoAmount
        ? `${withdrawal.cryptoAmount} ${withdrawal.currency} (${money(withdrawal.netAmount)})`
        : `${money(withdrawal.netAmount)} in ${withdrawal.currency}`;
      return {
        kind: 'WITHDRAWAL',
        title: 'Withdrawal sent',
        body: `${sent} is on its way to your address.`,
        href: '/wallet?tab=withdraw',
        key: `withdrawal:${withdrawal.id}:completed`,
      };
    }
    case 'REJECTED':
      return {
        kind: 'WITHDRAWAL',
        title: 'Withdrawal declined',
        // the gross amount, because the fee is returned with it
        body: `${money(withdrawal.amount)} has been returned to your balance. Ask support for the reason if it is not clear.`,
        href: '/wallet?tab=withdraw',
        key: `withdrawal:${withdrawal.id}:rejected`,
      };
    default:
      // PENDING, APPROVED and PROCESSING are the request working its way
      // through, and CANCELLED is the trader's own doing
      return null;
  }
}

export function tournamentStarted(tournament: { id: string; name: string }): NotificationDraft {
  return {
    kind: 'TOURNAMENT',
    title: `${tournament.name} has started`,
    body: 'Your chips are live. Positions taken in the tournament count towards its leaderboard.',
    href: '/tournaments',
    key: `tournament:${tournament.id}:started`,
  };
}

export function tournamentFinished(
  tournament: { id: string; name: string },
  entry: { rank: number | null; prize: number },
): NotificationDraft {
  const placed = entry.rank ? `You finished ${ordinal(entry.rank)}` : 'The final table is in';
  return {
    kind: 'TOURNAMENT',
    title: `${tournament.name} is over`,
    body:
      entry.prize > 0
        ? `${placed} and won ${money(entry.prize)}, paid into your live balance.`
        : `${placed}. No prize this time — the next tournament is on the way.`,
    href: '/tournaments',
    key: `tournament:${tournament.id}:finished`,
  };
}

export function supportReply(message: {
  id: string;
  body: string;
  subject?: string | null;
}): NotificationDraft {
  const trimmed = message.body.trim().replace(/\s+/g, ' ');
  return {
    kind: 'SUPPORT',
    title: 'Support replied',
    body: trimmed.length > 140 ? `${trimmed.slice(0, 139)}…` : trimmed,
    // the support desk is a widget rather than a page, so the centre opens it
    href: null,
    key: `support:${message.id}`,
  };
}

function ordinal(rank: number): string {
  const tens = rank % 100;
  if (tens >= 11 && tens <= 13) return `${rank}th`;
  switch (rank % 10) {
    case 1:
      return `${rank}st`;
    case 2:
      return `${rank}nd`;
    case 3:
      return `${rank}rd`;
    default:
      return `${rank}th`;
  }
}
