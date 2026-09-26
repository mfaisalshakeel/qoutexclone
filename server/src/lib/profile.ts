import { z } from 'zod';

/**
 * Profile preferences, and what counts as a valid one.
 *
 * Everything here is display: which colour a trader's initial sits on, how
 * dates and numbers are written, which language the interface is in, and what
 * they want to be told about. None of it touches money — amounts are USD cents
 * throughout, and `numberFormat` changes how they are written, never what they
 * are worth.
 */

/** The avatar palette. A monogram on a colour, not an upload. */
export const AVATARS = ['slate', 'amber', 'emerald', 'sky', 'violet', 'rose', 'teal', 'orange'] as const;
export type Avatar = (typeof AVATARS)[number];

/** Languages the interface offers. English is complete; the rest arrive in Phase 7. */
export const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Español' },
  { code: 'pt', name: 'Português' },
  { code: 'fr', name: 'Français' },
  { code: 'ar', name: 'العربية' },
  { code: 'ur', name: 'اردو' },
  { code: 'hi', name: 'हिन्दी' },
] as const;

/** Number formats on offer. The currency is always USD. */
export const NUMBER_FORMATS = [
  { code: 'en-US', example: '1,234.56' },
  { code: 'de-DE', example: '1.234,56' },
  { code: 'fr-FR', example: '1 234,56' },
  { code: 'en-IN', example: '1,23,456.78' },
] as const;

/** Only the languages an operator has actually enabled — the rest of LANGUAGES stays hidden until its translation is ready. */
export function enabledLanguages(codes: readonly string[]): typeof LANGUAGES[number][] {
  const enabled = new Set(codes);
  return LANGUAGES.filter((language) => enabled.has(language.code));
}

/** The notifications a trader can turn off. Money is not one of them. */
export const NOTIFY_KINDS = ['TRADE', 'TOURNAMENT', 'SYSTEM', 'SUPPORT'] as const;
export type NotifyKind = (typeof NOTIFY_KINDS)[number];

export type NotifyPrefs = Record<NotifyKind, boolean>;

export const DEFAULT_NOTIFY: NotifyPrefs = {
  TRADE: true,
  TOURNAMENT: true,
  SYSTEM: true,
  SUPPORT: true,
};

export const profileSchema = z.object({
  name: z.string().trim().min(2).max(60).optional(),
  country: z.string().trim().max(60).optional(),
  avatar: z.enum(AVATARS).optional(),
  timezone: z.string().max(64).optional(),
  language: z.enum(LANGUAGES.map((language) => language.code) as [string, ...string[]]).optional(),
  numberFormat: z.enum(NUMBER_FORMATS.map((format) => format.code) as [string, ...string[]]).optional(),
  notifyPrefs: z.record(z.enum(NOTIFY_KINDS), z.boolean()).optional(),
});

export type ProfileInput = z.infer<typeof profileSchema>;

/**
 * Whether an IANA zone is one this runtime knows.
 *
 * Checked rather than listed: the list is the platform's, it changes with the
 * runtime, and a zone that formats correctly is by definition a valid one.
 */
export function isKnownTimezone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone }).format(0);
    return true;
  } catch {
    return false;
  }
}

/** Stored preferences filled in with the defaults, whatever is missing. */
export function readNotifyPrefs(stored: unknown): NotifyPrefs {
  const prefs = { ...DEFAULT_NOTIFY };
  if (stored && typeof stored === 'object') {
    for (const kind of NOTIFY_KINDS) {
      const value = (stored as Record<string, unknown>)[kind];
      if (typeof value === 'boolean') prefs[kind] = value;
    }
  }
  return prefs;
}

/** Whether a notification of this kind should reach this trader at all. */
export function wantsNotification(stored: unknown, kind: string): boolean {
  if (!NOTIFY_KINDS.includes(kind as NotifyKind)) return true;
  return readNotifyPrefs(stored)[kind as NotifyKind];
}
