import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_PREFERENCES,
  ago,
  loadPreferences,
  merge,
  savePreferences,
  shouldChime,
  shouldPopBrowser,
  toneFor,
  unreadOf,
  type TraderNotification,
} from './notifications';

const item = (over: Partial<TraderNotification> & { id: string }): TraderNotification => ({
  kind: 'TRADE',
  title: 'EUR/USD Higher won',
  body: '+$8.50',
  href: '/history',
  read: false,
  createdAt: '2026-09-18T10:00:00.000Z',
  ...over,
});

describe('the notification centre list', () => {
  it('keeps the newest first', () => {
    const merged = merge(
      [item({ id: 'a', createdAt: '2026-09-18T10:00:00.000Z' })],
      [
        item({ id: 'b', createdAt: '2026-09-18T11:00:00.000Z' }),
        item({ id: 'c', createdAt: '2026-09-18T09:00:00.000Z' }),
      ],
    );
    expect(merged.map((row) => row.id)).toEqual(['b', 'a', 'c']);
  });

  it('never shows the same notification twice, and takes the newer copy', () => {
    const merged = merge(
      [item({ id: 'a', read: false })],
      [item({ id: 'a', read: true }), item({ id: 'a', read: true })],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].read).toBe(true);
    expect(unreadOf(merged)).toBe(0);
  });

  it('counts only what has not been read', () => {
    expect(unreadOf([item({ id: 'a' }), item({ id: 'b', read: true }), item({ id: 'c' })])).toBe(2);
  });
});

describe('announcing a notification', () => {
  it('stays silent on a page load, however many arrive', () => {
    expect(shouldChime(DEFAULT_PREFERENCES, { initialLoad: true })).toBe(false);
    expect(shouldChime(DEFAULT_PREFERENCES, { initialLoad: false })).toBe(true);
  });

  it('stays silent when the trader has muted it', () => {
    expect(shouldChime({ sound: false, browser: true }, { initialLoad: false })).toBe(false);
  });

  it('only pops outside the tab, with permission, and only when asked for', () => {
    const on = { sound: true, browser: true };
    expect(shouldPopBrowser(on, { permission: 'granted', hidden: true, initialLoad: false })).toBe(true);
    // the page already shows it
    expect(shouldPopBrowser(on, { permission: 'granted', hidden: false, initialLoad: false })).toBe(false);
    // no permission, no pop — and no prompt from here either
    expect(shouldPopBrowser(on, { permission: 'default', hidden: true, initialLoad: false })).toBe(false);
    expect(shouldPopBrowser(on, { permission: 'denied', hidden: true, initialLoad: false })).toBe(false);
    // not switched on
    expect(
      shouldPopBrowser(
        { sound: true, browser: false },
        {
          permission: 'granted',
          hidden: true,
          initialLoad: false,
        },
      ),
    ).toBe(false);
    // and never for the backlog the centre loads at sign-in
    expect(shouldPopBrowser(on, { permission: 'granted', hidden: true, initialLoad: true })).toBe(false);
  });

  it('gives each kind of news its own tone', () => {
    const tones = ['TRADE', 'DEPOSIT', 'WITHDRAWAL', 'TOURNAMENT', 'SUPPORT'].map((kind) => toneFor(kind).hz);
    expect(new Set(tones).size).toBe(tones.length);
    // an unknown kind still gets a sound rather than throwing
    expect(toneFor('SOMETHING_NEW').hz).toBeGreaterThan(0);
  });
});

describe('preferences', () => {
  beforeEach(() => localStorage.clear());

  it('default to a chime and no desktop alerts', () => {
    expect(loadPreferences()).toEqual({ sound: true, browser: false });
  });

  it('survive a round trip', () => {
    savePreferences({ sound: false, browser: true });
    expect(loadPreferences()).toEqual({ sound: false, browser: true });
  });

  it('fall back rather than throwing on nonsense in storage', () => {
    localStorage.setItem('quantex.notifications', '{not json');
    expect(loadPreferences()).toEqual(DEFAULT_PREFERENCES);
    localStorage.setItem('quantex.notifications', '{"sound":"yes please"}');
    expect(loadPreferences()).toEqual({ sound: true, browser: false });
  });
});

describe('relative time', () => {
  const now = new Date('2026-09-18T12:00:00.000Z').getTime();

  it('reads as a person would say it', () => {
    expect(ago('2026-09-18T11:59:30.000Z', now)).toBe('just now');
    expect(ago('2026-09-18T11:56:00.000Z', now)).toBe('4m ago');
    expect(ago('2026-09-18T09:00:00.000Z', now)).toBe('3h ago');
    expect(ago('2026-09-16T12:00:00.000Z', now)).toBe('2d ago');
    expect(ago('2026-09-04T12:00:00.000Z', now)).toBe('2w ago');
  });

  it('says nothing rather than "NaN" for a broken date', () => {
    expect(ago('not a date', now)).toBe('');
  });
});
