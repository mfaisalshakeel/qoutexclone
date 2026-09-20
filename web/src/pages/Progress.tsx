import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../lib/api';
import { dateTime, money } from '../lib/format';
import { Skeleton } from '../components/Skeleton';

interface Achievement {
  key: string;
  name: string;
  description: string;
  group: string;
  metric: string;
  target: number;
  progress: number;
  percent: number;
  unlocked: boolean;
  unlockedAt: string | null;
}

interface ProgressResponse {
  enabled: boolean;
  progress: {
    level: number;
    xp: number;
    levelFloor: number;
    nextLevelAt: number;
    remaining: number;
    percent: number;
  };
  achievements: Achievement[];
}

/** Money metrics are counted in cents; everything else is a plain number. */
const MONEY_METRICS = new Set(['volume', 'netProfit', 'totalDeposited']);

function amount(value: number, metric: string): string {
  return MONEY_METRICS.has(metric) ? money(value) : value.toLocaleString();
}

/**
 * Level, experience and badges.
 *
 * Everything is shown, earned or not, with how far off it is — a locked badge
 * with no progress on it is just a blank.
 */
export function Progress() {
  const [data, setData] = useState<ProgressResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await api.get<ProgressResponse>('/me/progress'));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load your progress');
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
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-2 w-full" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} className="h-24 w-full rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }

  if (!data.enabled) {
    return (
      <div className="mx-auto max-w-3xl">
        <div className="card p-8 text-center">
          <h1 className="text-lg font-bold">Levels and badges are switched off</h1>
          <p className="mt-2 text-sm text-slate-400">This platform is not running them right now.</p>
        </div>
      </div>
    );
  }

  const groups = [...new Set(data.achievements.map((achievement) => achievement.group))];
  const earned = data.achievements.filter((achievement) => achievement.unlocked).length;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <header>
        <h1 className="text-lg font-bold">Progress</h1>
        <p className="text-sm text-slate-400">
          Experience comes from trading. Badges come from everything else you do here.
        </p>
      </header>

      <section className="card p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-xl font-bold">
            Level {data.progress.level}
            <span className="ml-2 text-xs font-normal text-slate-400">
              {data.progress.xp.toLocaleString()} XP
            </span>
          </p>
          <p className="text-sm text-slate-400">
            <span className="font-semibold text-accent">{data.progress.remaining.toLocaleString()}</span> XP
            to level {data.progress.level + 1}
          </p>
        </div>
        <div
          role="progressbar"
          aria-valuenow={data.progress.percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Progress to level ${data.progress.level + 1}`}
          className="mt-4 h-2 overflow-hidden rounded-full bg-ink-600"
        >
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-500"
            style={{ width: `${data.progress.percent}%` }}
          />
        </div>
        <p className="mt-2 text-xs text-slate-500">
          {earned} of {data.achievements.length} badges earned.
        </p>
      </section>

      {groups.map((group) => (
        <section key={group} className="space-y-2">
          <h2 className="text-sm font-semibold text-slate-300">{group}</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {data.achievements
              .filter((achievement) => achievement.group === group)
              .map((achievement) => (
                <article
                  key={achievement.key}
                  className={`card p-4 ${achievement.unlocked ? 'border-accent/50' : ''}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className={`text-sm font-semibold ${achievement.unlocked ? '' : 'text-slate-300'}`}>
                        {achievement.name}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-400">{achievement.description}</p>
                    </div>
                    {achievement.unlocked && <span className="chip bg-up-soft text-up">earned</span>}
                  </div>

                  {achievement.unlocked ? (
                    <p className="mt-3 text-[11px] text-slate-500">
                      {achievement.unlockedAt
                        ? `Earned ${dateTime(achievement.unlockedAt)}`
                        : 'Earned just now'}
                    </p>
                  ) : (
                    <>
                      <div
                        role="progressbar"
                        aria-valuenow={achievement.percent}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label={achievement.name}
                        className="mt-3 h-1.5 overflow-hidden rounded-full bg-ink-600"
                      >
                        <div
                          className="h-full rounded-full bg-slate-400"
                          style={{ width: `${achievement.percent}%` }}
                        />
                      </div>
                      <p className="mt-1.5 text-[11px] text-slate-500">
                        {amount(achievement.progress, achievement.metric)} of{' '}
                        {amount(achievement.target, achievement.metric)}
                      </p>
                    </>
                  )}
                </article>
              ))}
          </div>
        </section>
      ))}
    </div>
  );
}
