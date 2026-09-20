import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { duration, money } from '../lib/format';
import { useAuth } from '../store/auth';

interface Limits {
  limits: { sessionReminderMin: number };
  usage: { lossCents: number };
}

/**
 * The interruption a trader asked for.
 *
 * It says how long they have been here and what today has cost, and it has to
 * be dismissed rather than fading — the point of a reminder nobody reads is
 * nothing at all. The clock starts when the app loads and restarts when the
 * reminder is dismissed.
 */
export function SessionReminder() {
  const user = useAuth((state) => state.user);
  const [minutes, setMinutes] = useState(0);
  const [loss, setLoss] = useState(0);
  const [open, setOpen] = useState(false);
  const startedAt = useRef(Date.now());

  const refresh = useCallback(async () => {
    if (!user) return;
    try {
      const data = await api.get<Limits>('/me/limits');
      setMinutes(data.limits.sessionReminderMin);
      setLoss(data.usage.lossCents);
    } catch {
      // without it there is simply no reminder; nothing to report
    }
  }, [user]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!user || minutes <= 0) return;
    const timer = setInterval(() => {
      if (Date.now() - startedAt.current >= minutes * 60_000) {
        void refresh();
        setOpen(true);
      }
    }, 15_000);
    return () => clearInterval(timer);
  }, [user, minutes, refresh]);

  if (!open || !user) return null;

  const elapsed = Math.round((Date.now() - startedAt.current) / 1000);

  return (
    <div
      role="alertdialog"
      aria-label="Session reminder"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4"
    >
      <div className="card w-full max-w-sm p-6">
        <h2 className="text-base font-bold">You have been trading for {duration(elapsed)}</h2>
        <p className="mt-2 text-sm text-slate-400">
          {loss > 0
            ? `You are down ${money(loss)} on live money today.`
            : 'You are not down on live money today.'}{' '}
          You asked us to tell you.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <button
            onClick={() => {
              startedAt.current = Date.now();
              setOpen(false);
            }}
            className="btn-primary flex-1"
          >
            Keep trading
          </button>
          <Link to="/account/limits" className="btn-ghost flex-1 text-center">
            My limits
          </Link>
        </div>
      </div>
    </div>
  );
}
