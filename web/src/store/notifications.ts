import { create } from 'zustand';
import { ApiError, api } from '../lib/api';
import { chime } from '../lib/sound';
import {
  loadPreferences,
  merge,
  savePreferences,
  shouldChime,
  shouldPopBrowser,
  unreadOf,
  type NotificationPreferences,
  type TraderNotification,
} from '../lib/notifications';

interface Feed {
  items: TraderNotification[];
  unread: number;
  cursor: string | null;
  enabled: boolean;
}

interface NotificationState {
  items: TraderNotification[];
  unread: number;
  cursor: string | null;
  enabled: boolean;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  loaded: boolean;
  preferences: NotificationPreferences;

  load: () => Promise<void>;
  loadMore: () => Promise<void>;
  /** A notification that arrived over the socket. */
  receive: (notification: TraderNotification) => void;
  markRead: (ids?: string[]) => Promise<void>;
  remove: (id: string) => Promise<void>;
  setPreference: <K extends keyof NotificationPreferences>(key: K, value: NotificationPreferences[K]) => void;
  reset: () => void;
}

/** Announces a notification the way this device is set up to announce it. */
function announce(notification: TraderNotification, preferences: NotificationPreferences): void {
  if (shouldChime(preferences, { initialLoad: false })) chime(notification.kind);

  const permission = typeof Notification === 'undefined' ? 'denied' : Notification.permission;
  const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
  if (!shouldPopBrowser(preferences, { permission, hidden, initialLoad: false })) return;

  try {
    // tagged by id, so a notification cannot stack up twice on a phone
    new Notification(notification.title, { body: notification.body, tag: notification.id });
  } catch {
    /* the browser refused it; the centre still has it */
  }
}

export const useNotifications = create<NotificationState>((set, get) => ({
  items: [],
  unread: 0,
  cursor: null,
  enabled: true,
  loading: false,
  loadingMore: false,
  error: null,
  loaded: false,
  preferences: loadPreferences(),

  async load() {
    set({ loading: !get().loaded, error: null });
    try {
      const feed = await api.get<Feed>('/me/notifications');
      set({
        items: merge([], feed.items),
        unread: feed.unread,
        cursor: feed.cursor,
        enabled: feed.enabled,
        loaded: true,
      });
    } catch (err) {
      set({ error: err instanceof ApiError ? err.message : 'Could not load notifications' });
    } finally {
      set({ loading: false });
    }
  },

  async loadMore() {
    const { cursor, loadingMore, items } = get();
    if (!cursor || loadingMore) return;
    set({ loadingMore: true });
    try {
      const feed = await api.get<Feed>(`/me/notifications?before=${encodeURIComponent(cursor)}`);
      set({ items: merge(items, feed.items), unread: feed.unread, cursor: feed.cursor });
    } catch {
      // the page that failed can be asked for again; the list keeps what it has
    } finally {
      set({ loadingMore: false });
    }
  },

  receive(notification) {
    const { items, preferences } = get();
    // the socket can repeat itself after a reconnect, so a known id is a no-op
    if (items.some((item) => item.id === notification.id)) return;
    const next = merge(items, [notification]);
    set({ items: next, unread: unreadOf(next) });
    announce(notification, preferences);
  },

  async markRead(ids) {
    const { items } = get();
    const target = ids ?? items.filter((item) => !item.read).map((item) => item.id);
    if (target.length === 0) return;

    // marked on screen at once: a badge that lingers after a click reads as broken
    const optimistic = items.map((item) => (target.includes(item.id) ? { ...item, read: true } : item));
    set({ items: optimistic, unread: unreadOf(optimistic) });
    try {
      const { unread } = await api.post<{ marked: number; unread: number }>('/me/notifications/read', {
        ids,
      });
      set({ unread });
    } catch {
      // the server disagreed, so take its word for it
      await get().load();
    }
  },

  async remove(id) {
    const { items } = get();
    const without = items.filter((item) => item.id !== id);
    set({ items: without, unread: unreadOf(without) });
    try {
      await api.del(`/me/notifications/${id}`);
    } catch {
      await get().load();
    }
  },

  setPreference(key, value) {
    const preferences = { ...get().preferences, [key]: value };
    set({ preferences });
    savePreferences(preferences);
  },

  reset() {
    set({
      items: [],
      unread: 0,
      cursor: null,
      loaded: false,
      error: null,
      // the preferences belong to the device, not to the session, so signing
      // out keeps them
      preferences: loadPreferences(),
    });
  },
}));
