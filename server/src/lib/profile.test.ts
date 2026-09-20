import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NOTIFY,
  isKnownTimezone,
  profileSchema,
  readNotifyPrefs,
  wantsNotification,
} from './profile.js';

describe('profileSchema', () => {
  it('accepts the preferences on offer', () => {
    const parsed = profileSchema.parse({
      name: 'Amelia Stone',
      avatar: 'emerald',
      language: 'ur',
      numberFormat: 'de-DE',
      notifyPrefs: { TRADE: false },
    });
    expect(parsed.avatar).toBe('emerald');
    expect(parsed.notifyPrefs).toEqual({ TRADE: false });
  });

  it('refuses anything not on offer', () => {
    expect(() => profileSchema.parse({ avatar: 'chartreuse' })).toThrow();
    expect(() => profileSchema.parse({ language: 'klingon' })).toThrow();
    expect(() => profileSchema.parse({ numberFormat: 'xx-YY' })).toThrow();
    expect(() => profileSchema.parse({ notifyPrefs: { MONEY: false } })).toThrow();
  });

  it('leaves out what was not sent, so a patch stays a patch', () => {
    expect(profileSchema.parse({ avatar: 'sky' })).toEqual({ avatar: 'sky' });
  });
});

describe('isKnownTimezone', () => {
  it('accepts real zones', () => {
    expect(isKnownTimezone('Europe/London')).toBe(true);
    expect(isKnownTimezone('Asia/Karachi')).toBe(true);
    expect(isKnownTimezone('UTC')).toBe(true);
  });

  it('refuses anything the runtime cannot format with', () => {
    expect(isKnownTimezone('Mars/Olympus')).toBe(false);
    expect(isKnownTimezone('')).toBe(false);
  });
});

describe('readNotifyPrefs', () => {
  it('defaults to everything on', () => {
    expect(readNotifyPrefs(null)).toEqual(DEFAULT_NOTIFY);
    expect(readNotifyPrefs({})).toEqual(DEFAULT_NOTIFY);
  });

  it('keeps what was stored and fills in the rest', () => {
    expect(readNotifyPrefs({ TRADE: false })).toEqual({ ...DEFAULT_NOTIFY, TRADE: false });
  });

  it('ignores junk rather than failing on it', () => {
    expect(readNotifyPrefs({ TRADE: 'no', NONSENSE: true })).toEqual(DEFAULT_NOTIFY);
    expect(readNotifyPrefs('broken')).toEqual(DEFAULT_NOTIFY);
  });
});

describe('wantsNotification', () => {
  it('follows the preference', () => {
    expect(wantsNotification({ TRADE: false }, 'TRADE')).toBe(false);
    expect(wantsNotification({ TRADE: false }, 'TOURNAMENT')).toBe(true);
  });

  it('lets through anything a trader cannot turn off', () => {
    // deposits and withdrawals are never optional: it is their money
    expect(wantsNotification({ DEPOSIT: false }, 'DEPOSIT')).toBe(true);
    expect(wantsNotification({ WITHDRAWAL: false }, 'WITHDRAWAL')).toBe(true);
  });
});
