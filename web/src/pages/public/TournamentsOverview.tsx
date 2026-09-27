import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { dateTime, money } from '../../lib/format';
import { usePageMeta } from '../../hooks/usePageMeta';
import { PublicHeader } from '../../components/home/PublicHeader';
import { SiteFooter } from '../../components/home/Sections';
import { RowSkeletons } from '../../components/Skeleton';
import type { Tournament } from '../../lib/types';

const STEP_KEYS = ['step1', 'step2', 'step3', 'step4'] as const;

const STATUS_KEY: Record<Tournament['status'], string> = {
  SCHEDULED: 'statusScheduled',
  RUNNING: 'statusRunning',
  FINISHED: 'statusFinished',
  CANCELLED: 'statusCancelled',
};

/** What tournaments are and how they work, plus whatever is scheduled or running right now. */
export function PublicTournamentsOverview() {
  const { t } = useTranslation();
  usePageMeta({
    title: t('tournamentsOverview.title'),
    description: t('tournamentsOverview.description'),
  });

  const [tournaments, setTournaments] = useState<Tournament[] | null>(null);

  useEffect(() => {
    api
      .get<{ tournaments: Tournament[] }>('/tournaments')
      .then(({ tournaments: list }) => setTournaments(list))
      .catch(() => setTournaments([]));
  }, []);

  const open = tournaments?.filter((tt) => tt.status === 'SCHEDULED' || tt.status === 'RUNNING') ?? [];

  return (
    <div className="min-h-dvh">
      <PublicHeader />
      <main className="mx-auto max-w-5xl px-4 pb-20 pt-4">
        <h1 className="text-3xl font-bold tracking-tight">{t('tournamentsOverview.title')}</h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-400">{t('tournamentsOverview.description')}</p>

        <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {STEP_KEYS.map((key, i) => (
            <div key={key} className="card p-5">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent-soft text-sm font-bold text-accent">
                {i + 1}
              </span>
              <p className="mt-3 text-sm font-semibold">{t(`tournamentsOverview.${key}Title`)}</p>
              <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
                {t(`tournamentsOverview.${key}Body`)}
              </p>
            </div>
          ))}
        </div>

        <h2 className="mt-12 text-xl font-bold tracking-tight">{t('tournamentsOverview.openRightNow')}</h2>
        <div className="mt-4">
          {tournaments === null && <RowSkeletons rows={3} className="space-y-3" rowClassName="card p-4" />}
          {tournaments !== null && open.length === 0 && (
            <p className="card p-6 text-center text-sm text-slate-500">{t('tournamentsOverview.empty')}</p>
          )}
          {open.length > 0 && (
            <div className="card divide-y divide-ink-700 overflow-hidden">
              {open.map((tournament) => (
                <div key={tournament.id} className="flex flex-wrap items-center gap-3 p-4">
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold">{tournament.name}</span>
                      <span
                        className={`chip ${tournament.status === 'RUNNING' ? 'bg-up-soft text-up' : 'bg-accent-soft text-accent'}`}
                      >
                        {t(`tournamentsOverview.${STATUS_KEY[tournament.status]}`)}
                      </span>
                    </span>
                    <span className="mt-1 block text-xs text-slate-500">
                      {t('tournamentsOverview.starts', { date: dateTime(tournament.startsAt) })} ·{' '}
                      {tournament.maxEntries > 0
                        ? t('tournamentsOverview.enteredOf', {
                            count: tournament.entrants,
                            max: tournament.maxEntries,
                          })
                        : t('tournamentsOverview.entered', { count: tournament.entrants })}
                    </span>
                  </span>
                  <span className="text-end text-xs text-slate-400">
                    <span className="block font-semibold text-slate-200">
                      {t('tournamentsOverview.prizePool', { amount: money(tournament.prizePool) })}
                    </span>
                    <span className="block">
                      {tournament.entryFee > 0
                        ? t('tournamentsOverview.entryFee', { amount: money(tournament.entryFee) })
                        : t('tournamentsOverview.freeEntry')}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mt-10 text-center">
          <Link to="/register" className="btn-primary !px-6 !py-3">
            {t('tournamentsOverview.createAccountToJoin')}
          </Link>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
