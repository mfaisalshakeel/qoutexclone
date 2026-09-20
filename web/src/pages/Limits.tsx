import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../lib/api';
import { dateTime, money } from '../lib/format';
import { useAuth } from '../store/auth';
import { toast } from '../store/toast';
import { Skeleton } from '../components/Skeleton';

interface Limits {
  dailyLossCents: number;
  dailyDepositCents: number;
  sessionReminderMin: number;
  excludedUntil: string | null;
  pending: Partial<Record<'dailyLossCents' | 'dailyDepositCents' | 'sessionReminderMin', number>> | null;
  pendingAt: string | null;
  coolingOffHours: number;
}

interface Response {
  limits: Limits;
  usage: { lossCents: number; depositCents: number };
  exclusionDays: number[];
}

const PENDING_LABELS: Record<string, string> = {
  dailyLossCents: 'Daily loss limit',
  dailyDepositCents: 'Daily deposit limit',
  sessionReminderMin: 'Session reminder',
};

/** Dollars in the input, cents on the wire. Empty means "no limit". */
function toCents(value: string): number {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) : 0;
}

/**
 * The limits a trader sets on themselves.
 *
 * Everything here is enforced on the server. The page says so, and says what
 * each limit will and will not stop, because a control someone does not
 * understand is one they will route around rather than trust.
 */
export function Limits() {
  const { refreshUser } = useAuth();
  const [data, setData] = useState<Response | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ loss: '', deposit: '', reminder: '' });
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<number | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const next = await api.get<Response>('/me/limits');
      setData(next);
      setForm({
        loss: next.limits.dailyLossCents ? String(next.limits.dailyLossCents / 100) : '',
        deposit: next.limits.dailyDepositCents ? String(next.limits.dailyDepositCents / 100) : '',
        reminder: next.limits.sessionReminderMin ? String(next.limits.sessionReminderMin) : '',
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load your limits');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await api.patch('/me/limits', {
        dailyLossCents: toCents(form.loss),
        dailyDepositCents: toCents(form.deposit),
        sessionReminderMin: Number(form.reminder) > 0 ? Math.round(Number(form.reminder)) : 0,
      });
      await load();
      toast.success('Limits saved');
    } catch (err) {
      toast.error('Could not save', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  };

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
        {[0, 1].map((index) => (
          <div key={index} className="card space-y-3 p-5">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-9 w-full" />
          </div>
        ))}
      </div>
    );
  }

  const { limits, usage } = data;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <header>
        <h1 className="text-lg font-bold">Responsible trading</h1>
        <p className="text-sm text-slate-400">
          These are enforced on our servers, not in your browser. Tightening one applies immediately;
          loosening one waits {limits.coolingOffHours} hours.
        </p>
      </header>

      {limits.excludedUntil && (
        <section className="card border-down/50 p-5">
          <h2 className="text-sm font-bold text-down">Your account is closed until further notice</h2>
          <p className="mt-1 text-sm text-slate-300">
            You asked us to close it until {dateTime(limits.excludedUntil)}. You can still withdraw what is
            yours; you cannot trade or deposit.
          </p>
        </section>
      )}

      {limits.pending && limits.pendingAt && (
        <section className="card border-accent/50 p-5">
          <h2 className="text-sm font-semibold">A change is waiting</h2>
          <ul className="mt-2 space-y-1 text-sm text-slate-300">
            {Object.entries(limits.pending).map(([field, value]) => (
              <li key={field}>
                {PENDING_LABELS[field] ?? field} →{' '}
                {field === 'sessionReminderMin'
                  ? value === 0
                    ? 'off'
                    : `${value} minutes`
                  : value === 0
                    ? 'no limit'
                    : money(value)}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-slate-400">Applies {dateTime(limits.pendingAt)}.</p>
          <button
            onClick={() =>
              void (async () => {
                await api.del('/me/limits/pending');
                await load();
                toast.success('Change cancelled');
              })()
            }
            className="btn-ghost mt-3"
          >
            Cancel it
          </button>
        </section>
      )}

      <form onSubmit={save} className="card space-y-5 p-5">
        <div>
          <label className="label" htmlFor="loss">
            Daily loss limit
          </label>
          <input
            id="loss"
            inputMode="decimal"
            value={form.loss}
            onChange={(event) => setForm({ ...form, loss: event.target.value })}
            className="field max-w-[200px]"
            placeholder="No limit"
          />
          <p className="mt-1.5 text-xs text-slate-400">
            No new positions once your losses on live money reach this in a day. Open positions still settle,
            and you can still withdraw. Today: {money(usage.lossCents)} lost.
          </p>
        </div>

        <div>
          <label className="label" htmlFor="deposit">
            Daily deposit limit
          </label>
          <input
            id="deposit"
            inputMode="decimal"
            value={form.deposit}
            onChange={(event) => setForm({ ...form, deposit: event.target.value })}
            className="field max-w-[200px]"
            placeholder="No limit"
          />
          <p className="mt-1.5 text-xs text-slate-400">Today: {money(usage.depositCents)} deposited.</p>
        </div>

        <div>
          <label className="label" htmlFor="reminder">
            Session reminder (minutes)
          </label>
          <input
            id="reminder"
            inputMode="numeric"
            value={form.reminder}
            onChange={(event) => setForm({ ...form, reminder: event.target.value })}
            className="field max-w-[200px]"
            placeholder="Off"
          />
          <p className="mt-1.5 text-xs text-slate-400">
            We interrupt with how long you have been here and what you are up or down.
          </p>
        </div>

        <button type="submit" disabled={busy} className="btn-primary">
          {busy ? 'Saving…' : 'Save limits'}
        </button>
      </form>

      {!limits.excludedUntil && (
        <section className="card space-y-3 p-5">
          <h2 className="text-sm font-semibold">Take a break</h2>
          <p className="text-sm text-slate-400">
            This closes trading and deposits for the period you choose. It cannot be shortened or cancelled,
            by you or by us. Withdrawals stay open the whole time.
          </p>
          <div className="flex flex-wrap gap-2">
            {data.exclusionDays.map((days) => (
              <button
                key={days}
                onClick={() => setConfirming(days)}
                className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${
                  confirming === days ? 'bg-down text-white' : 'bg-ink-700 text-slate-300 hover:bg-ink-600'
                }`}
              >
                {days === 365 ? '1 year' : days >= 30 ? `${Math.round(days / 30)} months` : `${days} days`}
              </button>
            ))}
          </div>
          {confirming !== null && (
            <div className="rounded-xl bg-down-soft p-4">
              <p className="text-sm text-down">
                Close the account for {confirming} days? This cannot be undone.
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() =>
                    void (async () => {
                      try {
                        await api.post('/me/self-exclude', { days: confirming });
                        await Promise.all([load(), refreshUser()]);
                        setConfirming(null);
                      } catch (err) {
                        toast.error('Could not do that', err instanceof ApiError ? err.message : undefined);
                      }
                    })()
                  }
                  className="btn-primary !bg-down"
                >
                  Yes, close it
                </button>
                <button onClick={() => setConfirming(null)} className="btn-ghost">
                  Not now
                </button>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
