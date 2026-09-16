import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../store/auth';
import { useTradingAccount } from '../store/tradingAccount';
import { api } from '../lib/api';
import { money } from '../lib/format';
import { toast } from '../store/toast';
import type { Tournament } from '../lib/types';

/** Demo/real account switch — the balance pill in the top bar. */
export function BalanceSwitcher() {
  const { user, setAccount, resetDemo } = useAuth();
  const { tournamentId, tournamentName, tournamentBalance, setTournament } = useTradingAccount();
  const [open, setOpen] = useState(false);
  const [joined, setJoined] = useState<Tournament[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  // tournaments the trader can currently play
  useEffect(() => {
    if (!user) return;
    api
      .get<{ tournaments: Tournament[] }>('/tournaments')
      .then(({ tournaments }) => {
        const live = tournaments.filter((t) => t.joined && t.status === 'RUNNING');
        setJoined(live);
        const current = live.find((t) => t.id === tournamentId);
        if (current) setTournament({ id: current.id, name: current.name, balance: current.myBalance ?? 0 });
        else if (tournamentId) setTournament(null); // it ended or was left
      })
      .catch(() => undefined);
  }, [user, tournamentId, setTournament]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  if (!user) return null;
  const inTournament = Boolean(tournamentId);
  const isDemo = !inTournament && user.activeAccount === 'DEMO';
  const balance = inTournament ? tournamentBalance ?? 0 : isDemo ? user.demoBalance : user.realBalance;

  const choose = async (accountType: 'DEMO' | 'REAL') => {
    setOpen(false);
    setTournament(null);
    if (accountType === user.activeAccount) return;
    await setAccount(accountType);
    toast.info(`${accountType === 'DEMO' ? 'Practice' : 'Live'} account selected`);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-lg border border-ink-500 bg-ink-700 px-3 py-2 text-left transition hover:border-ink-400"
      >
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${
            inTournament ? 'bg-accent' : isDemo ? 'bg-amber-400' : 'bg-up'
          }`}
        />
        <span className="leading-tight">
          <span className="block max-w-[7rem] truncate text-[10px] uppercase tracking-wide text-slate-400">
            {inTournament ? tournamentName ?? 'Tournament' : isDemo ? 'Practice' : 'Live'}
          </span>
          <span className="tabular block text-sm font-semibold">{money(balance)}</span>
        </span>
        <svg viewBox="0 0 20 20" className="h-4 w-4 text-slate-400" fill="currentColor">
          <path d="M5.5 8l4.5 4.5L14.5 8z" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-2 w-60 animate-fade-up rounded-xl border border-ink-500 bg-ink-800 p-1.5 shadow-2xl">
          {(['REAL', 'DEMO'] as const).map((type) => {
            const active = !inTournament && user.activeAccount === type;
            return (
              <button
                key={type}
                onClick={() => void choose(type)}
                className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left transition ${
                  active ? 'bg-accent-soft text-accent' : 'hover:bg-ink-700'
                }`}
              >
                <span>
                  <span className="block text-xs uppercase tracking-wide text-slate-400">
                    {type === 'DEMO' ? 'Practice account' : 'Live account'}
                  </span>
                  <span className="tabular text-sm font-semibold text-slate-100">
                    {money(type === 'DEMO' ? user.demoBalance : user.realBalance)}
                  </span>
                </span>
                {active && <span className="text-xs font-semibold">active</span>}
              </button>
            );
          })}
          {joined.map((tournament) => (
            <button
              key={tournament.id}
              onClick={() => {
                setOpen(false);
                setTournament({ id: tournament.id, name: tournament.name, balance: tournament.myBalance ?? 0 });
                toast.info(`Trading ${tournament.name}`, 'Positions are staked in tournament chips');
              }}
              className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left transition ${
                tournamentId === tournament.id ? 'bg-accent-soft text-accent' : 'hover:bg-ink-700'
              }`}
            >
              <span className="min-w-0">
                <span className="block truncate text-xs uppercase tracking-wide text-slate-400">
                  {tournament.name}
                </span>
                <span className="tabular text-sm font-semibold text-slate-100">
                  {money(tournament.myBalance ?? 0)} chips
                </span>
              </span>
              {tournamentId === tournament.id && <span className="text-xs font-semibold">active</span>}
            </button>
          ))}

          {user.lockedBalance > 0 && (
            <p className="px-3 py-1.5 text-[11px] text-slate-400">
              {money(user.lockedBalance)} held by pending withdrawals
            </p>
          )}
          <button
            onClick={async () => {
              setOpen(false);
              await resetDemo();
              toast.success('Practice balance reset to $10,000');
            }}
            className="mt-1 w-full rounded-lg px-3 py-2 text-left text-xs text-slate-400 transition hover:bg-ink-700 hover:text-slate-200"
          >
            Reset practice balance
          </button>
        </div>
      )}
    </div>
  );
}
