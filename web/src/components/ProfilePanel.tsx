import { useEffect, useMemo, useState } from 'react';
import { ApiError, api } from '../lib/api';
import { useAuth } from '../store/auth';
import { toast } from '../store/toast';
import { AVATAR_COLORS, Avatar } from './Avatar';

interface Options {
  avatars: string[];
  languages: { code: string; name: string }[];
  numberFormats: { code: string; example: string }[];
  notifyKinds: string[];
}

const NOTIFY_LABELS: Record<string, string> = {
  TRADE: 'Positions settling',
  TOURNAMENT: 'Tournaments',
  SYSTEM: 'Account and achievements',
  SUPPORT: 'Replies from support',
};

/** The zones offered up front. Anything else can still be typed. */
function timezones(): string[] {
  const all = (Intl as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.('timeZone');
  return all && all.length > 0 ? all : ['UTC'];
}

/**
 * Who a trader is here and how the interface reads to them.
 *
 * Amounts are always US dollars. The number format changes the separators and
 * nothing else, and the panel says so — a control that looks like it converts
 * your balance and does not is worse than no control.
 */
export function ProfilePanel() {
  const { user, refreshUser } = useAuth();
  const [options, setOptions] = useState<Options | null>(null);
  const [busy, setBusy] = useState(false);
  const [notify, setNotify] = useState<Record<string, boolean>>(user?.notifyPrefs ?? {});
  const zones = useMemo(timezones, []);

  const [form, setForm] = useState({
    name: user?.name ?? '',
    country: user?.country ?? '',
    avatar: user?.avatar ?? 'slate',
    timezone: user?.timezone ?? '',
    language: user?.language ?? 'en',
    numberFormat: user?.numberFormat ?? 'en-US',
  });

  useEffect(() => {
    api
      .get<Options>('/me/profile-options')
      .then(setOptions)
      .catch(() => setOptions(null));
  }, []);

  if (!user) return null;

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await api.patch('/me', {
        name: form.name,
        country: form.country || undefined,
        avatar: form.avatar,
        timezone: form.timezone || undefined,
        language: form.language,
        numberFormat: form.numberFormat,
      });
      await refreshUser();
      toast.success('Profile updated');
    } catch (err) {
      toast.error('Could not save', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  // the box moves as it is clicked and goes back if the server refuses:
  // waiting for a round trip makes a checkbox feel broken
  const toggle = async (kind: string, on: boolean) => {
    setNotify((current) => ({ ...current, [kind]: on }));
    try {
      await api.patch('/me', { notifyPrefs: { [kind]: on } });
      await refreshUser();
    } catch (err) {
      setNotify((current) => ({ ...current, [kind]: !on }));
      toast.error('Could not save', err instanceof ApiError ? err.message : undefined);
    }
  };

  return (
    <>
      <form onSubmit={save} className="card space-y-5 p-5">
        <h2 className="text-sm font-semibold">Profile</h2>

        <div className="flex items-center gap-4">
          <Avatar name={form.name || user.name} avatar={form.avatar} className="h-14 w-14 text-xl" />
          <fieldset className="min-w-0">
            <legend className="label">Avatar colour</legend>
            <div className="flex flex-wrap gap-2">
              {(options?.avatars ?? Object.keys(AVATAR_COLORS)).map((colour) => (
                <button
                  key={colour}
                  type="button"
                  aria-label={colour}
                  aria-pressed={form.avatar === colour}
                  onClick={() => setForm({ ...form, avatar: colour })}
                  className={`h-7 w-7 rounded-full ${AVATAR_COLORS[colour]} transition ${
                    form.avatar === colour ? 'ring-2 ring-white ring-offset-2 ring-offset-ink-800' : ''
                  }`}
                />
              ))}
            </div>
          </fieldset>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="name">
              Full name
            </label>
            <input
              id="name"
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              className="field"
              minLength={2}
              required
            />
          </div>
          <div>
            <label className="label" htmlFor="country">
              Country
            </label>
            <input
              id="country"
              value={form.country}
              onChange={(event) => setForm({ ...form, country: event.target.value })}
              className="field"
            />
          </div>
          <div>
            <label className="label" htmlFor="timezone">
              Timezone
            </label>
            <input
              id="timezone"
              list="timezone-list"
              value={form.timezone}
              onChange={(event) => setForm({ ...form, timezone: event.target.value })}
              className="field"
              placeholder="Follow this device"
            />
            <datalist id="timezone-list">
              {zones.map((zone) => (
                <option key={zone} value={zone} />
              ))}
            </datalist>
          </div>
          <div>
            <label className="label" htmlFor="language">
              Language
            </label>
            <select
              id="language"
              value={form.language}
              onChange={(event) => setForm({ ...form, language: event.target.value })}
              className="field"
            >
              {(options?.languages ?? [{ code: 'en', name: 'English' }]).map((language) => (
                <option key={language.code} value={language.code}>
                  {language.name}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="numberFormat">
              Number format
            </label>
            <select
              id="numberFormat"
              value={form.numberFormat}
              onChange={(event) => setForm({ ...form, numberFormat: event.target.value })}
              className="field max-w-[260px]"
            >
              {(options?.numberFormats ?? [{ code: 'en-US', example: '1,234.56' }]).map((format) => (
                <option key={format.code} value={format.code}>
                  {format.example}
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-xs text-slate-400">
              Every balance on this platform is in US dollars. This changes how the numbers are written, not
              what they are worth.
            </p>
          </div>
        </div>

        <button type="submit" disabled={busy} className="btn-primary">
          {busy ? 'Saving…' : 'Save changes'}
        </button>
      </form>

      <section className="card space-y-3 p-5">
        <h2 className="text-sm font-semibold">Notifications</h2>
        <p className="text-xs text-slate-400">
          Deposits and withdrawals always reach you. Everything else is your choice.
        </p>
        <ul className="space-y-2">
          {(options?.notifyKinds ?? Object.keys(NOTIFY_LABELS)).map((kind) => {
            const on = notify[kind] !== false;
            return (
              <li key={kind} className="flex items-center gap-3">
                <input
                  id={`notify-${kind}`}
                  type="checkbox"
                  checked={on}
                  onChange={(event) => void toggle(kind, event.target.checked)}
                  className="h-4 w-4 accent-accent"
                />
                <label htmlFor={`notify-${kind}`} className="text-sm text-slate-300">
                  {NOTIFY_LABELS[kind] ?? kind}
                </label>
              </li>
            );
          })}
        </ul>
      </section>
    </>
  );
}
