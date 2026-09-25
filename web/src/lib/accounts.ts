import type { Tournament } from './types';

/**
 * What the account switcher offers.
 *
 * Three kinds of money that never mix: live, practice, and a set of chips per
 * tournament. Which of them can be traded right now is a rule, not a style — a
 * tournament that has not started yet is listed so the trader knows they are in
 * it, but it cannot be selected, and the server would refuse a position on it
 * anyway.
 */

export type AccountKind = 'REAL' | 'DEMO' | 'TOURNAMENT';

export interface AccountOption {
  kind: AccountKind;
  /** The tournament's id, or null for the trader's own two accounts. */
  id: string | null;
  label: string;
  balance: number;
  /** Chips read differently from dollars, and are never called dollars. */
  chips: boolean;
  selectable: boolean;
  /** Why it cannot be selected, when it cannot. */
  note: string | null;
  /** A tournament's own market list. Null (every account but a scoped
   *  tournament) means every market is offered. */
  allowedAssetIds: string[] | null;
}

export interface PracticeConfig {
  startBalance: number;
  /** A refill is offered below this balance. 0 means always. */
  refillBelow: number;
}

export function accountOptions(input: {
  demoBalance: number;
  realBalance: number;
  tournaments: Tournament[];
  now?: number;
}): AccountOption[] {
  const now = input.now ?? Date.now();
  const options: AccountOption[] = [
    {
      kind: 'REAL',
      id: null,
      label: 'Live account',
      balance: input.realBalance,
      chips: false,
      selectable: true,
      note: null,
      allowedAssetIds: null,
    },
    {
      kind: 'DEMO',
      id: null,
      label: 'Practice account',
      balance: input.demoBalance,
      chips: false,
      selectable: true,
      note: null,
      allowedAssetIds: null,
    },
  ];

  const joined = input.tournaments
    .filter((tournament) => tournament.joined)
    .filter((tournament) => tournament.status === 'RUNNING' || tournament.status === 'SCHEDULED')
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());

  for (const tournament of joined) {
    const running = tournament.status === 'RUNNING' && new Date(tournament.endsAt).getTime() > now;
    options.push({
      kind: 'TOURNAMENT',
      id: tournament.id,
      label: tournament.name,
      balance: tournament.myBalance ?? 0,
      chips: true,
      selectable: running,
      note: running ? null : 'Not started yet',
      allowedAssetIds: tournament.allowedAssetIds,
    });
  }
  return options;
}

/** Whether the practice balance can be topped up, and what to say if not. */
export function refillState(
  demoBalance: number,
  config: PracticeConfig,
): { allowed: boolean; reason: string | null } {
  if (config.refillBelow <= 0) return { allowed: true, reason: null };
  if (demoBalance < config.refillBelow) return { allowed: true, reason: null };
  return {
    allowed: false,
    reason: `Available below ${cents(config.refillBelow)}`,
  };
}

/** The account a stale tournament selection should fall back to. */
export function stillPlayable(options: AccountOption[], tournamentId: string | null): boolean {
  if (!tournamentId) return true;
  return options.some((option) => option.id === tournamentId && option.selectable);
}

function cents(value: number): string {
  return `$${(value / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
