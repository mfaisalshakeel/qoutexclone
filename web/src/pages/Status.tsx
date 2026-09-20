import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../lib/api';
import { money } from '../lib/format';
import { useAuth } from '../store/auth';
import { Skeleton } from '../components/Skeleton';

interface Level {
  id: 'STANDARD' | 'PRO' | 'VIP';
  name: string;
  threshold: number;
  payoutBonus: number;
  depositBonus: number;
  priority: number;
}

interface StatusResponse {
  enabled: boolean;
  maxPayoutPct: number;
  levels: Level[];
  progress: {
    level: Level;
    next: Level | null;
    remaining: number;
    percent: number;
    totalDeposited: number;
  };
}

/**
 * Where a trader stands and what the next level is worth.
 *
 * The whole ladder is shown, not just the rung they are on: the point of the
 * page is the reason to climb, and a level whose perks are hidden until you
 * reach it is not a reason.
 */
export function Status() {
  const { user } = useAuth();
  const [data, setData] = useState<StatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await api.get<StatusResponse>('/me/status'));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load your status');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return (
      <div className="mx-auto max-w-3xl">
        <div className="card p-6 text-center">
          <p className="text-sm text-slate-300">{error}</p>
          <button onClick={() => void load()} className="btn-primary mt-4">
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="card space-y-3 p-5">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-2 w-full" />
          <Skeleton className="h-3 w-2/3" />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-40 w-full rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }

  if (!data.enabled) {
    return (
      <div className="mx-auto max-w-3xl">
        <div className="card p-8 text-center">
          <h1 className="text-lg font-bold">Status levels are switched off</h1>
          <p className="mt-2 text-sm text-slate-400">
            Every trader is on the same terms on this platform right now.
          </p>
        </div>
      </div>
    );
  }

  const { progress } = data;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <header>
        <h1 className="text-lg font-bold">Status</h1>
        <p className="text-sm text-slate-400">
          Your level comes from what you have deposited over the life of the account.
        </p>
      </header>

      <section className="card p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-xl font-bold">
            {progress.level.name}
            <span className="ml-2 text-xs font-normal text-slate-400">
              {money(progress.totalDeposited)} deposited
            </span>
          </p>
          {progress.next && (
            <p className="text-sm text-slate-400">
              <span className="font-semibold text-accent">{money(progress.remaining)}</span> to{' '}
              {progress.next.name}
            </p>
          )}
        </div>

        <div
          role="progressbar"
          aria-valuenow={progress.percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={
            progress.next ? `Progress to ${progress.next.name}` : `${progress.level.name}, the top level`
          }
          className="mt-4 h-2 overflow-hidden rounded-full bg-ink-600"
        >
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-500"
            style={{ width: `${progress.percent}%` }}
          />
        </div>

        <p className="mt-2 text-xs text-slate-500">
          {progress.next
            ? `${progress.percent}% of the way from ${progress.level.name} to ${progress.next.name}.`
            : 'You are on the top level. Nothing further to reach.'}
        </p>
      </section>

      <div className="grid gap-3 sm:grid-cols-3">
        {data.levels.map((level) => {
          const here = level.id === progress.level.id;
          const reached = level.priority <= progress.level.priority;
          return (
            <section
              key={level.id}
              aria-current={here ? 'true' : undefined}
              className={`card p-4 ${here ? 'border-accent/60' : reached ? '' : 'opacity-80'}`}
            >
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-bold">{level.name}</h2>
                {here && <span className="chip bg-accent/15 text-accent">you</span>}
                {!here && reached && <span className="chip bg-up-soft text-up">reached</span>}
              </div>
              <p className="mt-1 text-xs text-slate-400">
                {level.threshold === 0 ? 'From your first trade' : `${money(level.threshold)} deposited`}
              </p>
              <ul className="mt-3 space-y-1.5 text-xs text-slate-300">
                <li>
                  {level.payoutBonus > 0
                    ? `+${level.payoutBonus}% payout on your positions`
                    : 'Standard payouts'}
                </li>
                <li>
                  {level.depositBonus > 0 ? `+${level.depositBonus}% on every deposit` : 'No deposit bonus'}
                </li>
                <li>
                  {level.priority > 0 ? 'Withdrawals reviewed first' : 'Withdrawals in the usual order'}
                </li>
              </ul>
            </section>
          );
        })}
      </div>

      <p className="text-xs text-slate-500">
        A payout bonus applies to your own positions and never above {data.maxPayoutPct}%. It does not change
        the market price, and it does not apply inside a tournament, where everyone trades on the same terms.
        {user?.statusLevel?.enabled === false && ' Levels are currently switched off.'}
      </p>
    </div>
  );
}
