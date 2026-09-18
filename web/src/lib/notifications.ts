/**
 * The notification centre's own rules, kept pure.
 *
 * Whether a chime plays and whether the browser pops a notification are
 * decisions, not side effects: they depend on the trader's preferences, the
 * permission the browser has granted, and whether the tab is even being looked
 * at. Keeping them here means each one can be tested rather than guessed at
 * from a browser.
 */

export type NotificationKind = 'TRADE' | 'DEPOSIT' | 'WITHDRAWAL' | 'TOURNAMENT' | 'SUPPORT' | 'SYSTEM';

export interface TraderNotification {
  id: string;
  kind: NotificationKind | string;
  title: string;
  body: string;
  href: string | null;
  read: boolean;
  createdAt: string;
}

export interface NotificationPreferences {
  /** A chime on arrival. On by default: a trade result is worth hearing. */
  sound: boolean;
  /**
   * Notifications outside the tab. Off until the trader asks, because asking
   * the browser for permission unprompted is the kind of thing that gets a
   * platform blocked for good.
   */
  browser: boolean;
}

export const DEFAULT_PREFERENCES: NotificationPreferences = { sound: true, browser: false };

const STORAGE_KEY = 'quantex.notifications';

/** Per device, like the hotkeys: a phone and a desk are not the same room. */
export function loadPreferences(): NotificationPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PREFERENCES;
    const parsed = JSON.parse(raw) as Partial<NotificationPreferences>;
    return {
      sound: parsed.sound !== false,
      browser: parsed.browser === true,
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export function savePreferences(preferences: NotificationPreferences): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    /* a browser with storage denied keeps the defaults for the session */
  }
}

/** Newest first, and never the same notification twice. */
export function merge(existing: TraderNotification[], arriving: TraderNotification[]): TraderNotification[] {
  const byId = new Map(existing.map((item) => [item.id, item]));
  for (const item of arriving) byId.set(item.id, item);
  return [...byId.values()].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export function unreadOf(items: TraderNotification[]): number {
  return items.filter((item) => !item.read).length;
}

/** Sound is for news that arrives, so a page's first load is silent. */
export function shouldChime(
  preferences: NotificationPreferences,
  context: { initialLoad: boolean; reducedMotion?: boolean },
): boolean {
  if (!preferences.sound) return false;
  if (context.initialLoad) return false;
  // someone who has asked for less movement has not asked for less sound, so
  // reduced motion is deliberately not consulted here
  return true;
}

/**
 * A browser notification is for when the tab is not being watched. Popping one
 * over the very page that already shows it is noise twice.
 */
export function shouldPopBrowser(
  preferences: NotificationPreferences,
  context: { permission: string; hidden: boolean; initialLoad: boolean },
): boolean {
  if (!preferences.browser) return false;
  if (context.permission !== 'granted') return false;
  if (context.initialLoad) return false;
  return context.hidden;
}

/** "just now", "4m", "2h", "3d" — a centre reads better in relative time. */
export function ago(value: string | Date, now = Date.now()): string {
  const ms = now - new Date(value).getTime();
  if (!Number.isFinite(ms)) return '';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w ago`;
}

/** The tone a kind is announced with, so the ear can tell news apart. */
export function toneFor(kind: string): { hz: number; ms: number } {
  switch (kind) {
    case 'TRADE':
      return { hz: 880, ms: 120 };
    case 'DEPOSIT':
      return { hz: 1_046, ms: 160 };
    case 'WITHDRAWAL':
      return { hz: 660, ms: 160 };
    case 'TOURNAMENT':
      return { hz: 784, ms: 200 };
    case 'SUPPORT':
      return { hz: 587, ms: 140 };
    default:
      return { hz: 740, ms: 120 };
  }
}
