import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api } from '../lib/api';
import { countdown, dateTime, money } from '../lib/format';
import { realtime } from '../lib/ws';
import { useAuth } from '../store/auth';
import { toast } from '../store/toast';
import type { LeaderboardRow, Tournament } from '../lib/types';
import { RowSkeletons, Skeleton, SkeletonGroup } from '../components/Skeleton';

const STATUS_TONE: Record<Tournament['status'], string> = {
  SCHEDULED: 'bg-accent-soft text-accent',
  RUNNING: 'bg-up-soft text-up',
  FINISHED: 'bg-ink-600 text-slate-400',
  CANCELLED: 'bg-down-soft text-down',
};

export function Tournaments() {
  const user = useAuth((s) => s.user);
  const refreshUser = useAuth((s) => s.refreshUser);
  const [tournaments, setTournaments] = useState<Tournament[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [board, setBoard] = useState<LeaderboardRow[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [, tick] = useState(0);
  const boardFor = useRef<string | null>(null);

  const load = useCallback(async () => {
    const { tournaments: list } = await api.get<{ tournaments: Tournament[] }>('/tournaments');
    setTournaments(list);
    setOpenId((current) => current ?? list.find((t) => t.status === 'RUNNING')?.id ?? list[0]?.id ?? null);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // countdowns tick, and the server announces starts and finishes
  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 1000);
    const off = realtime.on('tournament:updated', () => void load());
    return () => {
      window.clearInterval(id);
      off();
    };
  }, [load]);

  useEffect(() => {
    if (!openId) return;
    if (boardFor.current !== openId) setBoard(null);
    boardFor.current = openId;
    api
      .get<{ leaderboard: LeaderboardRow[] }>(`/tournaments/${openId}/leaderboard`)
      .then(({ leaderboard }) => setBoard(leaderboard))
      .catch(() => setBoard([]));
  }, [openId, tournaments]);

  const join = async (tournament: Tournament) => {
    setBusy(tournament.id);
    try {
      await api.post(`/tournaments/${tournament.id}/join`);
      await load();
      await refreshUser();
      toast.success(`Joined ${tournament.name}`, `${money(tournament.startingBalance)} in tournament chips`);
    } catch (err) {
      toast.error('Could not join', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-4">
        <h1 className="text-lg font-bold">Tournaments</h1>
        <p className="text-xs text-slate-500">
          Trade a fixed stack of tournament chips against everyone else. The biggest stacks split the prize pool in
          real money.
        </p>
      </div>

      {!tournaments && <TournamentSkeletons />}

      {tournaments?.length === 0 && (
        <p className="card p-10 text-center text-sm text-slate-500">No tournaments scheduled right now.</p>
      )}

      <div className="space-y-3">
        {tournaments?.map((tournament) => {
          const live = tournament.status === 'RUNNING';
          const ended = tournament.status === 'FINISHED';
          return (
            <div key={tournament.id} className="card overflow-hidden">
              {/* the expander and the join action are siblings: a button inside a
                  button is invalid markup and browsers break it apart */}
              <div className="flex flex-wrap items-center gap-3 p-4">
                <button
                  onClick={() => setOpenId(tournament.id === openId ? null : tournament.id)}
                  className="min-w-0 flex-1 text-left"
                >
                  <span className="flex items-center gap-2 text-sm font-bold">
                    {tournament.name}
                    <span className={`chip ${STATUS_TONE[tournament.status]}`}>{tournament.status.toLowerCase()}</span>
                  </span>
                  {tournament.description && (
                    <span className="mt-0.5 block truncate text-[11px] text-slate-500">{tournament.description}</span>
                  )}
                  <span className="mt-1 block text-[11px] text-slate-500">
                    {tournament.entrants} entrants
                    {tournament.maxEntries > 0 ? ` / ${tournament.maxEntries}` : ''} ·{' '}
                    {tournament.entryFee > 0 ? `${money(tournament.entryFee)} entry` : 'free entry'} ·{' '}
                    {money(tournament.startingBalance)} chips
                  </span>
                </button>

                <div className="text-right">
                  <p className="text-[10px] uppercase tracking-wide text-slate-400">Prize pool</p>
                  <p className="tabular text-base font-bold text-up">{money(tournament.prizePool)}</p>
                  <p className="tabular text-[11px] text-slate-500">
                    {live
                      ? `ends in ${countdown(tournament.endsAt)}`
                      : ended
                        ? `ended ${dateTime(tournament.endsAt)}`
                        : `starts ${dateTime(tournament.startsAt)}`}
                  </p>
                </div>

                {tournament.joined ? (
                  <span className="chip bg-accent-soft text-accent">
                    {ended
                      ? tournament.myPrize > 0
                        ? `won ${money(tournament.myPrize)}`
                        : `placed #${tournament.myRank ?? '—'}`
                      : `${money(tournament.myBalance ?? 0)} chips`}
                  </span>
                ) : (
                  !ended && (
                    <button
                      onClick={() => void join(tournament)}
                      disabled={busy === tournament.id || !user}
                      className="btn-primary !px-3 !py-2 text-xs"
                    >
                      {tournament.entryFee > 0 ? `Join · ${money(tournament.entryFee)}` : 'Join free'}
                    </button>
                  )
                )}

                <button
                  onClick={() => setOpenId(tournament.id === openId ? null : tournament.id)}
                  className="btn-ghost !px-2.5 !py-2 text-xs"
                  aria-label="Toggle leaderboard"
                >
                  {openId === tournament.id ? '▴' : '▾'}
                </button>
              </div>

              {openId === tournament.id && (
                <div className="border-t border-ink-600">
                  {tournament.joined && live && (
                    <p className="bg-accent-soft px-4 py-2 text-[11px] text-accent">
                      You are in. Switch the terminal to this tournament from the account selector to trade your chips.
                    </p>
                  )}
                  {!board ? (
                    <RowSkeletons rows={4} rowClassName="px-4 py-2.5" className="divide-y divide-ink-700" />
                  ) : board.length === 0 ? (
                    <p className="p-6 text-center text-xs text-slate-500">No entrants yet — be the first.</p>
                  ) : (
                    <table className="w-full text-sm">
                      <thead className="bg-ink-700/60 text-[10px] uppercase tracking-wide text-slate-400">
                        <tr>
                          <th className="px-4 py-2 text-left font-medium">#</th>
                          <th className="px-4 py-2 text-left font-medium">Trader</th>
                          <th className="px-4 py-2 text-right font-medium">Chips</th>
                          <th className="hidden px-4 py-2 text-right font-medium sm:table-cell">Trades</th>
                          <th className="px-4 py-2 text-right font-medium">Prize</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-ink-700">
                        {board.map((row) => (
                          <tr key={row.id} className={row.userId === user?.id ? 'bg-accent-soft/40' : undefined}>
                            <td className="px-4 py-2.5 text-xs font-bold text-slate-400">{row.place}</td>
                            <td className="px-4 py-2.5 text-xs font-semibold">{row.name}</td>
                            <td className="tabular px-4 py-2.5 text-right text-xs">
                              {money(row.balance)}
                              <span className={`ml-2 ${row.profit >= 0 ? 'text-up' : 'text-down'}`}>
                                {money(row.profit, { sign: true })}
                              </span>
                            </td>
                            <td className="tabular hidden px-4 py-2.5 text-right text-xs text-slate-400 sm:table-cell">
                              {row.trades} ({row.wins}W)
                            </td>
                            <td className="tabular px-4 py-2.5 text-right text-xs font-semibold text-up">
                              {row.prize > 0 ? money(row.prize) : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TournamentSkeletons() {
  return (
    <SkeletonGroup label="Loading tournaments" className="space-y-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="card flex flex-wrap items-center gap-3 p-4">
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex items-center gap-2">
              <Skeleton className="h-3.5 w-40" />
              <Skeleton className="h-5 w-16 !rounded-full" />
            </div>
            <Skeleton className="h-2.5 w-64 max-w-full" />
            <Skeleton className="h-2.5 w-48 max-w-full" />
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <Skeleton className="h-2 w-16" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-2.5 w-24" />
          </div>
          <Skeleton className="h-8 w-24 !rounded-lg" />
        </div>
      ))}
    </SkeletonGroup>
  );
}
