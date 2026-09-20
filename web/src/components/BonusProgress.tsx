import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { money } from '../lib/format';

interface Hold {
  locked: number;
  remaining: number;
  percent: number;
  bonuses: {
    id: string;
    source: string;
    amount: number;
    required: number;
    staked: number;
    percent: number;
  }[];
}

const SOURCES: Record<string, string> = {
  deposit: 'Deposit bonus',
  promo: 'Promo code',
  status: 'Status bonus',
  coupon: 'Bonus coupon',
  manual: 'Granted by support',
};

/**
 * What is on the balance but not yet withdrawable.
 *
 * Bonus money is real money on a real balance — it can be traded from the
 * moment it lands. What it cannot do is leave until it has been staked, and
 * that is the one thing a trader needs stated plainly and continuously, not
 * buried in terms they agreed to once.
 */
export function BonusProgress() {
  const [hold, setHold] = useState<Hold | null>(null);

  const load = useCallback(async () => {
    try {
      setHold(await api.get<Hold>('/wallet/bonuses'));
    } catch {
      // the wallet works without it; nothing here is worth an error state
      setHold(null);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!hold || hold.locked === 0) return null;

  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">Bonus still to release</h2>
        <p className="tabular text-sm font-bold text-accent">{money(hold.locked)}</p>
      </div>
      <p className="mt-1 text-xs text-slate-400">
        You can trade with it now. To withdraw it, stake {money(hold.remaining)} more.
      </p>

      <div
        role="progressbar"
        aria-valuenow={hold.percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Bonus turnover progress"
        className="mt-3 h-2 overflow-hidden rounded-full bg-ink-600"
      >
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-500"
          style={{ width: `${hold.percent}%` }}
        />
      </div>

      <ul className="mt-3 space-y-1.5">
        {hold.bonuses.map((bonus) => (
          <li key={bonus.id} className="flex flex-wrap items-baseline gap-x-2 text-xs">
            <span className="text-slate-300">{SOURCES[bonus.source] ?? bonus.source}</span>
            <span className="tabular text-slate-400">{money(bonus.amount)}</span>
            <span className="ml-auto tabular text-slate-500">
              {money(bonus.staked)} of {money(bonus.required)} staked
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
