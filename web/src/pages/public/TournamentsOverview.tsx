import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { dateTime, money } from '../../lib/format';
import { usePageMeta } from '../../hooks/usePageMeta';
import { PublicHeader } from '../../components/home/PublicHeader';
import { SiteFooter } from '../../components/home/Sections';
import { RowSkeletons } from '../../components/Skeleton';
import type { Tournament } from '../../lib/types';

const STEPS = [
  {
    title: 'Join with a click',
    body: 'No separate sign-up — join from your account with any entry fee the tournament asks for, or free.',
  },
  {
    title: 'Trade a fresh stack of chips',
    body: 'A tournament balance never mixes with your practice or live money. Trade it exactly like a live account.',
  },
  {
    title: 'Climb the board',
    body: 'The leaderboard ranks every entrant by chip balance in real time, until the tournament ends.',
  },
  {
    title: 'Top finishers split the pool',
    body: 'Prizes are paid out by finishing position once the tournament closes, straight to your live balance.',
  },
];

const STATUS_LABEL: Record<Tournament['status'], string> = {
  SCHEDULED: 'Starts soon',
  RUNNING: 'Live now',
  FINISHED: 'Finished',
  CANCELLED: 'Cancelled',
};

/** What tournaments are and how they work, plus whatever is scheduled or running right now. */
export function PublicTournamentsOverview() {
  usePageMeta({
    title: 'Tournaments',
    description:
      'Trade a fresh stack of chips against the field. Join a tournament and climb the leaderboard for a share of a real prize pool.',
  });

  const [tournaments, setTournaments] = useState<Tournament[] | null>(null);

  useEffect(() => {
    api
      .get<{ tournaments: Tournament[] }>('/tournaments')
      .then(({ tournaments: list }) => setTournaments(list))
      .catch(() => setTournaments([]));
  }, []);

  const open = tournaments?.filter((t) => t.status === 'SCHEDULED' || t.status === 'RUNNING') ?? [];

  return (
    <div className="min-h-dvh">
      <PublicHeader />
      <main className="mx-auto max-w-5xl px-4 pb-20 pt-4">
        <h1 className="text-3xl font-bold tracking-tight">Tournaments</h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-400">
          Trade the leaderboard, not just the market. Join a tournament, get a fresh stack of chips, and climb
          the board against everyone else entered — top finishers split a real prize pool.
        </p>

        <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step, i) => (
            <div key={step.title} className="card p-5">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent-soft text-sm font-bold text-accent">
                {i + 1}
              </span>
              <p className="mt-3 text-sm font-semibold">{step.title}</p>
              <p className="mt-1.5 text-xs leading-relaxed text-slate-400">{step.body}</p>
            </div>
          ))}
        </div>

        <h2 className="mt-12 text-xl font-bold tracking-tight">Open right now</h2>
        <div className="mt-4">
          {tournaments === null && <RowSkeletons rows={3} className="space-y-3" rowClassName="card p-4" />}
          {tournaments !== null && open.length === 0 && (
            <p className="card p-6 text-center text-sm text-slate-500">
              Nothing scheduled at the moment — new tournaments are announced regularly. Create an account to
              be notified when one opens.
            </p>
          )}
          {open.length > 0 && (
            <div className="card divide-y divide-ink-700 overflow-hidden">
              {open.map((t) => (
                <div key={t.id} className="flex flex-wrap items-center gap-3 p-4">
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold">{t.name}</span>
                      <span
                        className={`chip ${t.status === 'RUNNING' ? 'bg-up-soft text-up' : 'bg-accent-soft text-accent'}`}
                      >
                        {STATUS_LABEL[t.status]}
                      </span>
                    </span>
                    <span className="mt-1 block text-xs text-slate-500">
                      Starts {dateTime(t.startsAt)} · {t.entrants} entered
                      {t.maxEntries > 0 ? ` of ${t.maxEntries}` : ''}
                    </span>
                  </span>
                  <span className="text-right text-xs text-slate-400">
                    <span className="block font-semibold text-slate-200">{money(t.prizePool)} pool</span>
                    <span className="block">
                      {t.entryFee > 0 ? `${money(t.entryFee)} entry` : 'Free entry'}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mt-10 text-center">
          <Link to="/register" className="btn-primary !px-6 !py-3">
            Create an account to join
          </Link>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
