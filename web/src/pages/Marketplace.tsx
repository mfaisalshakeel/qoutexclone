import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../lib/api';
import { dateTime, money } from '../lib/format';
import { useAuth } from '../store/auth';
import { toast } from '../store/toast';
import { Skeleton } from '../components/Skeleton';

type ItemKind = 'PAYOUT_BOOSTER' | 'RISK_FREE' | 'DEPOSIT_BONUS' | 'PRACTICE_REFILL';

interface Item {
  id: string;
  key: string;
  name: string;
  description: string;
  kind: ItemKind;
  priceCents: number;
  pricePoints: number;
  config: Record<string, number>;
}

interface Owned {
  id: string;
  status: 'OWNED' | 'ACTIVE' | 'USED' | 'EXPIRED';
  usesLeft: number;
  activatedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  config: Record<string, number>;
  item: { key: string; name: string; description: string; kind: ItemKind };
}

interface ShopResponse {
  enabled: boolean;
  points: number;
  balance: number;
  items: Item[];
  inventory: Owned[];
}

const KIND_LABELS: Record<ItemKind, string> = {
  PAYOUT_BOOSTER: 'Payout booster',
  RISK_FREE: 'Risk-free',
  DEPOSIT_BONUS: 'Deposit coupon',
  PRACTICE_REFILL: 'Practice',
};

/** What activating one of these will do, said plainly before they press it. */
function effectOf(kind: ItemKind, config: Record<string, number>): string {
  switch (kind) {
    case 'PAYOUT_BOOSTER':
      return `+${config.bonusPct}% payout for ${config.minutes} minutes from the moment you start it.`;
    case 'RISK_FREE':
      return `Refunds your next ${config.trades} losing position${config.trades === 1 ? '' : 's'}, up to ${money(config.maxRefundCents)} each, within ${config.hours} hours.`;
    case 'DEPOSIT_BONUS':
      return `Adds ${config.percent}% to your next deposit, up to ${money(config.maxBonusCents)}, for ${config.days} days.`;
    case 'PRACTICE_REFILL':
      return `Adds ${money(config.amountCents)} to your practice balance straight away.`;
  }
}

/**
 * The shop and the inventory.
 *
 * Everything says what it does before it is bought and again before it is
 * started, because an item with a clock on it is worth nothing if it is
 * activated at the wrong moment.
 */
export function Marketplace() {
  const { refreshUser } = useAuth();
  const [data, setData] = useState<ShopResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await api.get<ShopResponse>('/me/marketplace'));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the marketplace');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (key: string, run: () => Promise<void>, done: string) => {
    setBusy(key);
    try {
      await run();
      await Promise.all([load(), refreshUser()]);
      toast.success(done);
    } catch (err) {
      toast.error('That did not work', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(null);
    }
  };

  if (error) {
    return (
      <div className="mx-auto max-w-4xl">
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
      <div className="mx-auto max-w-4xl space-y-4">
        <Skeleton className="h-16 w-full rounded-2xl" />
        <div className="grid gap-3 sm:grid-cols-2">
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} className="h-40 w-full rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }

  if (!data.enabled) {
    return (
      <div className="mx-auto max-w-4xl">
        <div className="card p-8 text-center">
          <h1 className="text-lg font-bold">The marketplace is closed</h1>
          <p className="mt-2 text-sm text-slate-400">This platform is not running it right now.</p>
        </div>
      </div>
    );
  }

  const live = data.inventory.filter((owned) => owned.status === 'ACTIVE' || owned.status === 'OWNED');
  const spent = data.inventory.filter((owned) => owned.status === 'USED' || owned.status === 'EXPIRED');

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold">Marketplace</h1>
          <p className="text-sm text-slate-400">
            Boosters, cover and coupons, bought with points earned by trading or with your balance.
          </p>
        </div>
        <div className="rounded-xl bg-ink-700/60 px-4 py-2 text-right">
          <p className="text-[10px] uppercase tracking-wide text-slate-400">Points</p>
          <p className="tabular text-lg font-bold text-accent">{data.points.toLocaleString()}</p>
        </div>
      </header>

      {data.items.length === 0 ? (
        <div className="card p-8 text-center text-sm text-slate-400">
          There is nothing on sale at the moment.
        </div>
      ) : (
        <section className="grid gap-3 sm:grid-cols-2">
          {data.items.map((item) => (
            <article key={item.id} className="card flex flex-col gap-3 p-4">
              <div>
                <div className="flex items-start justify-between gap-2">
                  <h2 className="text-sm font-bold">{item.name}</h2>
                  <span className="chip bg-ink-600 text-slate-300">{KIND_LABELS[item.kind]}</span>
                </div>
                <p className="mt-1 text-xs text-slate-400">{item.description}</p>
              </div>
              <div className="mt-auto flex flex-wrap gap-2">
                {item.pricePoints > 0 && (
                  <button
                    onClick={() =>
                      void act(
                        `points-${item.id}`,
                        async () => {
                          await api.post('/me/marketplace/buy', { itemId: item.id, payWith: 'points' });
                        },
                        `${item.name} added to your inventory`,
                      )
                    }
                    disabled={busy !== null || data.points < item.pricePoints}
                    className="btn-ghost flex-1 disabled:opacity-50"
                  >
                    {item.pricePoints.toLocaleString()} points
                  </button>
                )}
                {item.priceCents > 0 && (
                  <button
                    onClick={() =>
                      void act(
                        `cents-${item.id}`,
                        async () => {
                          await api.post('/me/marketplace/buy', { itemId: item.id, payWith: 'cents' });
                        },
                        `${item.name} added to your inventory`,
                      )
                    }
                    disabled={busy !== null || data.balance < item.priceCents}
                    className="btn-primary flex-1 disabled:opacity-50"
                  >
                    {money(item.priceCents)}
                  </button>
                )}
              </div>
            </article>
          ))}
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-slate-300">Your inventory</h2>
        {live.length === 0 ? (
          <div className="card p-6 text-center text-sm text-slate-400">
            Nothing here yet. Anything you buy waits until you start it.
          </div>
        ) : (
          <ul className="space-y-2">
            {live.map((owned) => (
              <li key={owned.id} className="card flex flex-wrap items-center gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">
                    {owned.item.name}
                    {owned.status === 'ACTIVE' && (
                      <span className="chip ml-2 bg-up-soft text-up">running</span>
                    )}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-400">{effectOf(owned.item.kind, owned.config)}</p>
                  {owned.status === 'ACTIVE' && owned.expiresAt && (
                    <p className="mt-1 text-[11px] text-slate-500">
                      Until {dateTime(owned.expiresAt)}
                      {owned.item.kind === 'RISK_FREE' && ` · ${owned.usesLeft} use(s) left`}
                    </p>
                  )}
                </div>
                {owned.status === 'OWNED' && (
                  <button
                    onClick={() =>
                      void act(
                        `activate-${owned.id}`,
                        async () => {
                          await api.post('/me/marketplace/activate', { inventoryId: owned.id });
                        },
                        `${owned.item.name} started`,
                      )
                    }
                    disabled={busy !== null}
                    className="btn-primary"
                  >
                    Start it
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {spent.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-slate-300">Spent</h2>
          <ul className="divide-y divide-ink-600/70 rounded-2xl border border-ink-600/70">
            {spent.slice(0, 20).map((owned) => (
              <li key={owned.id} className="flex flex-wrap items-baseline gap-x-3 px-4 py-2.5">
                <span className="text-sm text-slate-300">{owned.item.name}</span>
                <span className="chip bg-ink-600 text-slate-400">{owned.status.toLowerCase()}</span>
                <span className="ml-auto text-xs text-slate-500">{dateTime(owned.createdAt)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
