import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { dismiss, loadDismissed } from '../lib/announcements';
import type { Announcement, AnnouncementStyle } from '../lib/types';

const TONE: Record<AnnouncementStyle, string> = {
  info: 'border-accent/30 bg-accent/10 text-accent',
  warning: 'border-amber-400/30 bg-amber-400/10 text-amber-300',
  success: 'border-up/30 bg-up-soft text-up',
};

const POLL_MS = 60_000;

/**
 * The platform-wide banner from the content CMS. Public and unauthenticated,
 * like the risk warning it sits alongside, so it shows the same to a visitor
 * and a signed-in trader.
 */
export function AnnouncementBanner() {
  const [items, setItems] = useState<Announcement[]>([]);
  const [dismissed, setDismissed] = useState<string[]>(() => loadDismissed());

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      api
        .get<{ announcements: Announcement[] }>('/content/announcements')
        .then(({ announcements }) => {
          if (!cancelled) setItems(announcements);
        })
        // a failed fetch is not evidence an announcement ended: the last known set stands
        .catch(() => undefined);
    };
    load();
    const id = window.setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const visible = items.filter((item) => !dismissed.includes(item.id));
  if (visible.length === 0) return null;

  return (
    <div className="space-y-px">
      {visible.map((item) => (
        <div key={item.id} role="status" className={`border-b px-3 py-2.5 sm:px-4 ${TONE[item.style]}`}>
          <div className="mx-auto flex w-full max-w-[1400px] flex-wrap items-center gap-x-3 gap-y-2 text-sm">
            <p>{item.message}</p>
            {item.linkUrl && (
              <a href={item.linkUrl} target="_blank" rel="noreferrer" className="font-semibold underline">
                {item.linkLabel || 'Learn more'}
              </a>
            )}
            <button
              onClick={() => {
                dismiss(item.id);
                setDismissed((current) => [...current, item.id]);
              }}
              aria-label="Dismiss this announcement"
              className="ml-auto rounded px-2 text-current opacity-70 transition hover:opacity-100"
            >
              ✕
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
