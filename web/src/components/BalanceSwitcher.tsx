import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../store/auth';
import { useMarket } from '../store/market';
import { useTradingAccount } from '../store/tradingAccount';
import { ApiError, api } from '../lib/api';
import { money } from '../lib/format';
import { accountOptions, refillState, stillPlayable, type AccountOption } from '../lib/accounts';
import { toast } from '../store/toast';
import type { Tournament } from '../lib/types';

/**
 * The account switcher: live money, practice money, and a set of chips for each
 * tournament the trader is in. The three never mix, so the pill always says
 * which one a position would be staked from.
 */
export function BalanceSwitcher() {
  const { user, setAccount, resetDemo } = useAuth();
  const practice = useMarket((s) => s.practice);
  const { tournamentId, tournamentName, tournamentBalance, setTournament } = useTradingAccount();
  const [open, setOpen] = useState(false);
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  // whether that list has actually arrived: until it has, a stored tournament
  // selection cannot be judged, and dropping it would silently move the
  // trader's money back to practice on every page load
  const [listed, setListed] = useState(false);
  const [refilling, setRefilling] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // the tournaments the trader has joined, playable or not yet
  useEffect(() => {
    if (!user) return;
    api
      .get<{ tournaments: Tournament[] }>('/tournaments')
      .then(({ tournaments: all }) => {
        setTournaments(all);
        setListed(true);
      })
      // a failed fetch is not evidence that a tournament has ended, so the
      // selection stands until the list says otherwise
      .catch(() => undefined);
  }, [user]);

  const options = useMemo(
    () =>
      user
        ? accountOptions({
            demoBalance: user.demoBalance,
            realBalance: user.realBalance,
            tournaments,
          })
        : [],
    [user, tournaments],
  );

  // a tournament that has ended, or that the trader has left, is not an account
  // any more: the selection falls back rather than staking chips that are gone
  useEffect(() => {
    if (!listed || !tournamentId) return;
    const current = options.find((option) => option.id === tournamentId);
    if (!current || !current.selectable) {
      setTournament(null);
      return;
    }
    // after a reload the store only remembers the id, so the name and the chip
    // balance come from this list — but only then. Afterwards the ticket's own
    // response is the fresher number, and re-applying this snapshot would undo
    // every stake the moment it was taken.
    if (tournamentName === null || tournamentBalance === null) {
      setTournament({ id: current.id!, name: current.label, balance: current.balance });
    }
  }, [listed, options, tournamentId, tournamentBalance, tournamentName, setTournament]);

  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!user) return null;

  const inTournament = Boolean(tournamentId) && stillPlayable(options, tournamentId);
  const isDemo = !inTournament && user.activeAccount === 'DEMO';
  const balance = inTournament ? (tournamentBalance ?? 0) : isDemo ? user.demoBalance : user.realBalance;
  const refill = refillState(user.demoBalance, practice);

  const choose = async (option: AccountOption) => {
    if (!option.selectable) return;
    setOpen(false);

    if (option.kind === 'TOURNAMENT') {
      setTournament({ id: option.id!, name: option.label, balance: option.balance });
      toast.info(`Trading ${option.label}`, 'Positions are staked in tournament chips');
      return;
    }

    setTournament(null);
    if (option.kind === user.activeAccount) return;
    await setAccount(option.kind);
    toast.info(`${option.kind === 'DEMO' ? 'Practice' : 'Live'} account selected`);
  };

  const topUp = async () => {
    setRefilling(true);
    try {
      await resetDemo();
      setOpen(false);
      toast.success(`Practice balance topped up to ${money(practice.startBalance)}`);
    } catch (err) {
      toast.error('Could not top up', err instanceof ApiError ? err.message : 'Please try again');
    } finally {
      setRefilling(false);
    }
  };

  const activeOption = (option: AccountOption) =>
    option.kind === 'TOURNAMENT'
      ? tournamentId === option.id
      : !inTournament && user.activeAccount === option.kind;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Trading account: ${
          inTournament ? (tournamentName ?? 'Tournament') : isDemo ? 'Practice' : 'Live'
        }`}
        className="flex items-center gap-2 rounded-lg border border-ink-500 bg-ink-700 px-3 py-2 text-left transition hover:border-ink-400"
      >
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${
            inTournament ? 'bg-accent' : isDemo ? 'bg-amber-400' : 'bg-up'
          }`}
        />
        <span className="leading-tight">
          <span className="block max-w-[7rem] truncate text-[10px] uppercase tracking-wide text-slate-400">
            {inTournament ? (tournamentName ?? 'Tournament') : isDemo ? 'Practice' : 'Live'}
          </span>
          <span className="tabular block text-sm font-semibold">{money(balance)}</span>
        </span>
        <svg viewBox="0 0 20 20" className="h-4 w-4 text-slate-400" fill="currentColor">
          <path d="M5.5 8l4.5 4.5L14.5 8z" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Trading accounts"
          className="absolute right-0 z-30 mt-2 w-64 animate-fade-up rounded-xl border border-ink-500 bg-ink-800 p-1.5 shadow-2xl"
        >
          {options.map((option) => {
            const active = activeOption(option);
            return (
              <button
                key={`${option.kind}-${option.id ?? 'own'}`}
                role="menuitem"
                onClick={() => void choose(option)}
                disabled={!option.selectable}
                className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left transition ${
                  active ? 'bg-accent-soft text-accent' : 'hover:bg-ink-700'
                } ${option.selectable ? '' : 'cursor-not-allowed opacity-60'}`}
              >
                <span className="min-w-0">
                  <span className="block truncate text-xs uppercase tracking-wide text-slate-400">
                    {option.label}
                  </span>
                  <span className="tabular text-sm font-semibold text-slate-100">
                    {money(option.balance)}
                    {option.chips && <span className="ml-1 text-xs font-normal text-slate-400">chips</span>}
                  </span>
                </span>
                {active ? (
                  <span className="text-xs font-semibold">active</span>
                ) : (
                  option.note && <span className="text-[11px] text-slate-500">{option.note}</span>
                )}
              </button>
            );
          })}

          {user.lockedBalance > 0 && (
            <p className="px-3 py-1.5 text-[11px] text-slate-400">
              {money(user.lockedBalance)} held by pending withdrawals
            </p>
          )}

          <div className="mt-1 border-t border-ink-600 pt-1">
            <button
              role="menuitem"
              onClick={() => void topUp()}
              disabled={!refill.allowed || refilling}
              title={refill.reason ?? undefined}
              className="w-full rounded-lg px-3 py-2 text-left text-xs text-slate-400 transition hover:bg-ink-700 hover:text-slate-200 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent"
            >
              {refilling ? 'Topping up…' : `Top up practice to ${money(practice.startBalance)}`}
              {!refill.allowed && (
                <span className="mt-0.5 block text-[11px] text-slate-500">{refill.reason}</span>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
