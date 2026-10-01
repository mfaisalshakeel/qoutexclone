import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ApiError, api } from '../../lib/api';
import { toast } from '../../store/toast';
import { Empty, Loading, PageHead } from '../../components/admin/ui';

interface SettingRow {
  key: string;
  group: string;
  label: string;
  help?: string;
  public: boolean;
  value: unknown;
  default: unknown;
  overridden: boolean;
  type: 'boolean' | 'number' | 'string' | 'numberList' | 'stringList';
}

const GROUP_BLURB: Record<string, string> = {
  general: 'Branding, defaults and maintenance mode.',
  trading: 'Expiries, stake bounds and the practice account.',
  wallet: 'Deposit and withdrawal limits, fees and review rules.',
  growth: 'Referrals, status levels, bonuses and the marketplace.',
  compliance: 'Verification requirements and the gates that depend on them.',
  security: 'Sign-in, sessions, rate limits and admin access.',
  email: 'The SMTP account outgoing mail is sent through.',
  seo: 'What crawlers and link previews see.',
  localisation: 'Languages and regional formatting.',
};

const GROUP_LABELS: Record<string, string> = {
  general: 'General',
  trading: 'Trading',
  wallet: 'Payments',
  growth: 'Growth',
  compliance: 'Compliance',
  security: 'Security',
  email: 'Email / SMTP',
  seo: 'SEO',
  localisation: 'Localisation',
};

/** Renders itself from the server's settings registry, so new keys need no UI work. */
export function AdminSettings() {
  const [rows, setRows] = useState<SettingRow[] | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const { settings } = await api.get<{ settings: SettingRow[] }>('/admin/settings');
      setRows(settings);
      setDraft({});
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load settings');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return (
      <>
        <PageHead title="Settings" />
        <div className="card p-8 text-center">
          <p className="text-sm text-slate-300">{error}</p>
          <button onClick={() => void load()} className="btn-ghost mt-3 text-xs">
            Try again
          </button>
        </div>
      </>
    );
  }

  if (!rows) {
    return (
      <>
        <PageHead title="Settings" />
        <Loading />
      </>
    );
  }

  const dirty = Object.keys(draft).length > 0;

  /** Text inputs hold strings; convert back to the registry's shape on save. */
  const parse = (row: SettingRow, raw: string): unknown => {
    if (row.type === 'number') return Number(raw);
    if (row.type === 'numberList')
      return raw
        .split(',')
        .map((part) => Number(part.trim()))
        .filter((value) => Number.isFinite(value));
    if (row.type === 'stringList')
      return raw
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean);
    return raw;
  };

  const display = (row: SettingRow): string => {
    const value = draft[row.key] ?? (Array.isArray(row.value) ? row.value.join(', ') : String(row.value));
    return value;
  };

  const save = async () => {
    const payload: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(draft)) {
      const row = rows.find((candidate) => candidate.key === key);
      if (row) payload[key] = parse(row, raw);
    }
    setSaving(true);
    try {
      const { settings } = await api.patch<{ settings: SettingRow[] }>('/admin/settings', payload);
      setRows(settings);
      setDraft({});
      toast.success('Settings saved', 'Every connected client has the new values');
    } catch (err) {
      toast.error('Could not save', err instanceof ApiError ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (row: SettingRow, next: boolean) => {
    try {
      const { settings } = await api.patch<{ settings: SettingRow[] }>('/admin/settings', {
        [row.key]: next,
      });
      setRows(settings);
      toast.success(`${row.label} ${next ? 'enabled' : 'disabled'}`);
    } catch (err) {
      toast.error('Could not save', err instanceof ApiError ? err.message : undefined);
    }
  };

  const reset = async (row: SettingRow) => {
    try {
      const { settings } = await api.post<{ settings: SettingRow[] }>(`/admin/settings/${row.key}/reset`);
      setRows(settings);
      setDraft((current) => {
        const next = { ...current };
        delete next[row.key];
        return next;
      });
      toast.info(`${row.label} restored to default`);
    } catch (err) {
      toast.error('Could not reset', err instanceof ApiError ? err.message : undefined);
    }
  };

  const groups = [...new Set(rows.map((row) => row.group))];
  // the open tab lives in the URL: an operator can link a colleague straight to
  // Payments, and a refresh after saving does not throw them back to General
  const activeGroup = groups.includes(params.get('tab') ?? '') ? params.get('tab')! : groups[0];
  const search = query.trim().toLowerCase();
  const matches = (row: SettingRow) =>
    !search ||
    row.label.toLowerCase().includes(search) ||
    row.key.toLowerCase().includes(search) ||
    (row.help ?? '').toLowerCase().includes(search);

  // searching looks across every group, because an operator who knows the name
  // of a setting should not have to guess which tab someone filed it under
  const visible = rows.filter((row) => (search ? matches(row) : row.group === activeGroup));
  const perGroupHits = search
    ? groups.map((group) => rows.filter((row) => row.group === group && matches(row)).length)
    : [];

  return (
    <>
      <PageHead
        title="Settings"
        subtitle="Runtime configuration. Changes apply immediately, with no restart."
        action={
          <span className="text-[12px] text-slate-500">
            {dirty ? 'Unsaved changes below' : 'All changes saved'}
          </span>
        }
      />

      {rows.length === 0 && <Empty text="No settings registered" />}

      <div className="card mb-4 flex flex-col gap-3 p-2 lg:flex-row lg:items-center">
        <div
          role="tablist"
          aria-label="Setting groups"
          className="scroll-quiet -mx-1 flex gap-1 overflow-x-auto px-1"
        >
          {groups.map((group, index) => {
            const hits = search ? perGroupHits[index] : null;
            const on = !search && group === activeGroup;
            return (
              <button
                key={group}
                role="tab"
                aria-selected={on}
                onClick={() => {
                  setQuery('');
                  setParams(group === groups[0] ? {} : { tab: group }, { replace: true });
                }}
                className={`shrink-0 rounded-lg px-3.5 py-2 text-[13px] font-medium transition ${
                  on
                    ? 'bg-selected text-selected-fg shadow-sm'
                    : 'text-slate-400 hover:bg-ink-700/70 hover:text-slate-100'
                }`}
              >
                {GROUP_LABELS[group] ?? group}
                {hits !== null && hits > 0 && (
                  <span className="ml-1.5 rounded-full bg-accent-soft px-1.5 text-[10px] font-semibold text-accent">
                    {hits}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="relative lg:ml-auto">
          <svg
            aria-hidden
            viewBox="0 0 24 24"
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
          >
            <circle cx="11" cy="11" r="6.5" />
            <path d="M16 16l4 4" strokeLinecap="round" />
          </svg>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search every setting"
            aria-label="Search settings"
            className="field w-full !pl-9 lg:w-72"
          />
        </div>
      </div>

      <div className="card overflow-hidden">
        {!search && (
          <div className="border-b border-ink-600 px-5 py-4">
            <h2 className="text-sm font-semibold text-slate-100">
              {GROUP_LABELS[activeGroup] ?? activeGroup}
            </h2>
            <p className="mt-0.5 text-[12px] text-slate-500">{GROUP_BLURB[activeGroup] ?? ''}</p>
          </div>
        )}

        <div className="divide-y divide-ink-700">
          {visible.length === 0 && (
            <p className="py-12 text-center text-sm text-slate-500">
              {search ? `Nothing matches “${query}”.` : 'Nothing in this group yet.'}
            </p>
          )}
          {visible.map((row) => (
            <div
              key={row.key}
              className="flex flex-col gap-3 px-5 py-4 transition-colors hover:bg-ink-700/30 sm:flex-row sm:items-center sm:gap-6"
            >
              <div className="min-w-0 sm:flex-1">
                <label htmlFor={`setting-${row.key}`} className="block text-sm font-medium text-slate-200">
                  {row.label}
                </label>
                {row.help && (
                  <p className="mt-1 max-w-xl text-[12px] leading-relaxed text-slate-500">{row.help}</p>
                )}
                {/* the raw key is for support, not for reading: it leads no row,
                    but a search is exactly when someone is looking for one */}
                {search && (
                  <p className="mt-1 font-mono text-[10px] text-slate-500">
                    {GROUP_LABELS[row.group] ?? row.group} · {row.key}
                  </p>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-2 sm:justify-end">
                {row.type === 'boolean' ? (
                  <button
                    id={`setting-${row.key}`}
                    role="switch"
                    aria-checked={Boolean(row.value)}
                    onClick={() => void toggle(row, !row.value)}
                    className={`relative h-6 w-11 shrink-0 rounded-full border transition ${
                      row.value ? 'border-transparent bg-up-solid' : 'border-ink-500 bg-ink-700'
                    }`}
                  >
                    <span
                      className={`absolute top-[3px] h-[18px] w-[18px] rounded-full bg-white shadow transition-all ${
                        row.value ? 'left-[23px]' : 'left-[3px]'
                      }`}
                    />
                  </button>
                ) : (
                  <input
                    id={`setting-${row.key}`}
                    value={display(row)}
                    inputMode={row.type === 'number' ? 'decimal' : 'text'}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, [row.key]: event.target.value }))
                    }
                    className={`field w-full sm:w-60 ${draft[row.key] !== undefined ? '!border-accent' : ''}`}
                  />
                )}

                {row.overridden ? (
                  <button
                    onClick={() => void reset(row)}
                    title="Restore the default"
                    aria-label={`Restore the default for ${row.label}`}
                    className="btn-icon"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      className="h-4 w-4"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.7"
                    >
                      <path d="M4 12a8 8 0 1 0 2.5-5.8" strokeLinecap="round" />
                      <path d="M4 4v4h4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                ) : (
                  <span className="hidden h-8 w-8 sm:block" />
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* a save bar that follows you down a long group, rather than a button
          that scrolls away the moment you start editing */}
      {dirty && (
        <div className="sticky bottom-4 z-20 mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-accent/40 bg-ink-800/95 px-4 py-3 shadow-[var(--shadow-pop)] backdrop-blur">
          <span className="text-[13px] text-slate-300">
            {Object.keys(draft).length} unsaved change{Object.keys(draft).length === 1 ? '' : 's'}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={() => setDraft({})} className="btn-ghost !py-2 text-xs">
              Discard
            </button>
            <button onClick={() => void save()} disabled={saving} className="btn-primary !py-2 text-xs">
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
