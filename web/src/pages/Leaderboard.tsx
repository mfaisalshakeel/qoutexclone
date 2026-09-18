import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../lib/api';
import { money } from '../lib/format';
import { toast } from '../store/toast';
import { RowSkeletons } from '../components/Skeleton';

interface Row {
  rank: number;
  display: string;
  country: string | null;
  flag: string | null;
  profit: number;
  trades: number;
  winRate: number;
  isYou: boolean;
}

interface Board {
  rows: Row[];
  updatedAt: number;
  traders: number;
  enabled: boolean;
  optedOut?: boolean;
}

const REFRESH_MS = 30_000;

/**
 * Today's top traders.
 *
 * Live-money profit only — a practice account starts with ten thousand and
 * would otherwise own the board every day, which would make it meaningless.
 * Names are masked server-side; a trader can keep themselves off it entirely.
 */
export function Leaderboard() {
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // the box moves the moment it is clicked; the round trip catches up after
  const [choice, setChoice] = useState<boolean | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      setBoard(await api.get<Board>('/me/leaderboard'));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the leaderboard');
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  const setOptOut = async (optOut: boolean) => {
    setChoice(optOut);
    setSaving(true);
    try {
      await api.patch<{ optedOut: boolean }>('/me/leaderboard', { optOut });
      toast.success(optOut ? 'You are off the leaderboard' : 'You are on the leaderboard');
      await load();
      setChoice(null);
    } catch (err) {
      // the choice did not stick, so the box goes back to what the server has
      setChoice(null);
      toast.error('Could not save', err instanceof ApiError ? err.message : 'Please try again');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl p-3 md:p-6">
      <header className="mb-4">
        <h1 className="text-xl font-bold tracking-tight text-white">Top traders today</h1>
        <p className="mt-1 text-xs text-slate-400">
          Profit on settled live positions since midnight UTC. Names are masked, and practice and tournament
          trading is not counted.
        </p>
      </header>

      {error && !board && (
        <div className="rounded-xl border border-down/40 bg-down/10 p-5 text-sm text-slate-200">
          <p>{error}</p>
          <button
            onClick={() => void load()}
            className="mt-3 rounded-lg bg-ink-600 px-3 py-1.5 text-xs font-semibold text-white"
          >
            Try again
          </button>
        </div>
      )}

      {!board && !error && (
        <div className="card p-2">
          <RowSkeletons rows={8} avatar rowClassName="px-3 py-2.5" />
        </div>
      )}

      {board && !board.enabled && (
        <div className="card p-6 text-center text-sm text-slate-400">
          The leaderboard is turned off on this platform.
        </div>
      )}

      {board?.enabled && (
        <>
          {board.rows.length === 0 ? (
            <p className="card p-6 text-center text-sm text-slate-400">
              No live positions have settled yet today. The board fills as the day trades.
            </p>
          ) : (
            <ol className="card divide-y divide-ink-700" aria-label="Today's ranking">
              {board.rows.map((row) => (
                <li
                  key={`${row.rank}-${row.display}`}
                  className={`flex items-center gap-3 px-3 py-2.5 ${row.isYou ? 'bg-accent-soft' : ''}`}
                >
                  <span
                    className={`tabular w-7 shrink-0 text-center text-xs font-bold ${
                      row.rank <= 3 ? 'text-amber-400' : 'text-slate-500'
                    }`}
                  >
                    {row.rank}
                  </span>
                  <span className="shrink-0 text-base" aria-hidden="true">
                    {row.flag ?? '🏳'}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-slate-100">
                      {row.display}
                      {row.isYou && <span className="ml-1.5 chip bg-accent text-white">You</span>}
                    </span>
                    <span className="block text-[11px] text-slate-500">
                      {row.trades} position{row.trades === 1 ? '' : 's'} · {row.winRate}% won
                      {row.country ? ` · ${row.country}` : ''}
                    </span>
                  </span>
                  <span
                    className={`tabular shrink-0 text-sm font-bold ${row.profit >= 0 ? 'text-up' : 'text-down'}`}
                  >
                    {row.profit >= 0 ? '+' : '−'}
                    {money(Math.abs(row.profit))}
                  </span>
                </li>
              ))}
            </ol>
          )}

          <label className="mt-4 flex items-start gap-2.5 rounded-xl border border-ink-600 bg-ink-800/60 p-3 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={choice ?? !!board.optedOut}
              disabled={saving}
              onChange={(event) => void setOptOut(event.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-ink-500 bg-ink-900"
            />
            <span>
              Keep me off the leaderboard
              <span className="mt-0.5 block text-[11px] text-slate-500">
                Your figures are then left out entirely, not just hidden from the list.
              </span>
            </span>
          </label>
        </>
      )}
    </div>
  );
}
