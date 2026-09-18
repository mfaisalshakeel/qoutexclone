import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ago, type TraderNotification } from '../lib/notifications';
import { useNotifications } from '../store/notifications';
import { useSupport } from '../store/support';
import { toast } from '../store/toast';
import { IconBell, IconBellOff, IconVolume } from './Icons';
import { RowSkeletons } from './Skeleton';

const KIND_TINT: Record<string, string> = {
  TRADE: 'bg-accent',
  DEPOSIT: 'bg-up',
  WITHDRAWAL: 'bg-amber-400',
  TOURNAMENT: 'bg-purple-400',
  SUPPORT: 'bg-sky-400',
  SYSTEM: 'bg-slate-400',
};

/**
 * The notification centre: a bell with an unread count, and a panel of what has
 * happened while the trader was elsewhere.
 *
 * The badge is the whole point, so it is loaded once at sign-in rather than when
 * the panel is first opened — a centre you have to open to discover you have
 * mail is not a notification centre.
 */
export function NotificationCentre() {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const openSupport = useSupport((s) => s.setOpen);

  const items = useNotifications((s) => s.items);
  const unread = useNotifications((s) => s.unread);
  const loading = useNotifications((s) => s.loading);
  const loadingMore = useNotifications((s) => s.loadingMore);
  const error = useNotifications((s) => s.error);
  const cursor = useNotifications((s) => s.cursor);
  const enabled = useNotifications((s) => s.enabled);
  const preferences = useNotifications((s) => s.preferences);
  const load = useNotifications((s) => s.load);
  const loadMore = useNotifications((s) => s.loadMore);
  const markRead = useNotifications((s) => s.markRead);
  const setPreference = useNotifications((s) => s.setPreference);

  useEffect(() => {
    void load();
  }, [load]);

  // a panel that stays open behind a click elsewhere feels stuck
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const openPanel = () => {
    setOpen((was) => !was);
    if (!open) void load();
  };

  const visit = (notification: TraderNotification) => {
    void markRead([notification.id]);
    setOpen(false);
    if (notification.kind === 'SUPPORT') openSupport(true);
    else if (notification.href) navigate(notification.href);
  };

  /**
   * Browser notifications are asked for here and nowhere else: the permission
   * prompt has to come from something the trader just clicked, or browsers
   * quietly refuse it for good.
   */
  const toggleBrowser = async () => {
    if (preferences.browser) {
      setPreference('browser', false);
      return;
    }
    if (typeof Notification === 'undefined') {
      toast.error('Not supported', 'This browser cannot show notifications outside the tab.');
      return;
    }
    const permission =
      Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    if (permission !== 'granted') {
      toast.info('Permission needed', 'Your browser blocked notifications for this site.');
      return;
    }
    setPreference('browser', true);
  };

  if (!enabled) return null;

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={openPanel}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-expanded={open}
        className="relative flex h-9 w-9 items-center justify-center rounded-lg text-slate-300 transition hover:bg-ink-700 hover:text-white"
      >
        <IconBell />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-down px-1 text-[10px] font-bold text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          className="fixed inset-x-2 top-16 z-40 max-h-[75vh] animate-fade-up overflow-hidden rounded-xl border border-ink-500 bg-ink-800 shadow-2xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-auto sm:mt-2 sm:w-96"
        >
          <div className="flex items-center gap-2 border-b border-ink-600 px-3 py-2">
            <h2 className="text-sm font-semibold text-white">Notifications</h2>
            {unread > 0 && (
              <button
                onClick={() => void markRead()}
                className="ml-auto rounded-lg px-2 py-1 text-xs font-semibold text-accent transition hover:bg-ink-700"
              >
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-[52vh] overflow-y-auto">
            {loading && items.length === 0 && (
              <div className="p-2">
                <RowSkeletons rows={4} rowClassName="px-2 py-2.5" />
              </div>
            )}

            {error && items.length === 0 && !loading && (
              <div className="p-5 text-center text-sm text-slate-300">
                <p>{error}</p>
                <button
                  onClick={() => void load()}
                  className="mt-3 rounded-lg bg-ink-600 px-3 py-1.5 text-xs font-semibold text-white"
                >
                  Try again
                </button>
              </div>
            )}

            {!loading && !error && items.length === 0 && (
              <p className="p-6 text-center text-sm text-slate-400">
                Nothing yet. Trade results, payments and support replies land here.
              </p>
            )}

            {items.length > 0 && (
              <ul aria-label="Recent notifications">
                {items.map((item) => (
                  <li key={item.id} className="border-b border-ink-700/60 last:border-0">
                    <button
                      onClick={() => visit(item)}
                      className={`flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition hover:bg-ink-700/60 ${
                        item.read ? '' : 'bg-accent-soft'
                      }`}
                    >
                      <span
                        aria-hidden="true"
                        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${KIND_TINT[item.kind] ?? KIND_TINT.SYSTEM}`}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline gap-2">
                          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-100">
                            {item.title}
                          </span>
                          <span className="shrink-0 text-[11px] text-slate-500">{ago(item.createdAt)}</span>
                        </span>
                        <span className="mt-0.5 block text-xs leading-snug text-slate-400">{item.body}</span>
                      </span>
                      {!item.read && <span className="sr-only">Unread</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {cursor && (
              <button
                onClick={() => void loadMore()}
                disabled={loadingMore}
                className="w-full px-3 py-2.5 text-xs font-semibold text-slate-300 transition hover:bg-ink-700 disabled:opacity-60"
              >
                {loadingMore ? 'Loading…' : 'Show older'}
              </button>
            )}
          </div>

          <div className="flex items-center gap-1 border-t border-ink-600 px-2 py-2">
            <button
              onClick={() => setPreference('sound', !preferences.sound)}
              aria-pressed={preferences.sound}
              className={`flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold transition ${
                preferences.sound ? 'text-slate-200 hover:bg-ink-700' : 'text-slate-500 hover:bg-ink-700'
              }`}
            >
              <IconVolume className="h-4 w-4" />
              {preferences.sound ? 'Sound on' : 'Sound off'}
            </button>
            <button
              onClick={() => void toggleBrowser()}
              aria-pressed={preferences.browser}
              className={`flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold transition ${
                preferences.browser ? 'text-slate-200 hover:bg-ink-700' : 'text-slate-500 hover:bg-ink-700'
              }`}
            >
              {preferences.browser ? <IconBell className="h-4 w-4" /> : <IconBellOff className="h-4 w-4" />}
              {preferences.browser ? 'Desktop alerts on' : 'Desktop alerts off'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
