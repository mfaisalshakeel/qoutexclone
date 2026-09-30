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
          <button onClick={() => void save()} disabled={!dirty || saving} className="btn-primary">
            {saving ? 'Saving…' : dirty ? `Save ${Object.keys(draft).length} change(s)` : 'Saved'}
          </button>
        }
      />

      {rows.length === 0 && <Empty text="No settings registered" />}

      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
        <div
          role="tablist"
          aria-label="Setting groups"
          className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1"
        >
          {groups.map((group, index) => {
            const hits = search ? perGroupHits[index] : null;
            return (
              <button
                key={group}
                role="tab"
                aria-selected={!search && group === activeGroup}
                onClick={() => {
                  setQuery('');
                  setParams(group === groups[0] ? {} : { tab: group }, { replace: true });
                }}
                className={`shrink-0 rounded-lg px-3 py-2 text-sm font-medium transition ${
                  !search && group === activeGroup
                    ? 'bg-accent-soft text-accent'
                    : 'text-slate-400 hover:bg-ink-700 hover:text-slate-100'
                }`}
              >
                {GROUP_LABELS[group] ?? group}
                {hits !== null && hits > 0 && (
                  <span className="ml-1.5 text-[11px] text-slate-500">{hits}</span>
                )}
              </button>
            );
          })}
        </div>

        <div className="lg:ml-auto">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search every setting"
            aria-label="Search settings"
            className="field w-full lg:w-64"
          />
        </div>
      </div>

      {dirty && (
        <p className="mb-3 rounded-lg bg-amber-400/10 px-3 py-2 text-[11px] text-amber-300">
          {Object.keys(draft).length} unsaved change(s). Switching tabs keeps them; leaving the page loses
          them.
        </p>
      )}

      <div className="card divide-y divide-ink-700 p-4">
        {visible.length === 0 && (
          <p className="py-8 text-center text-sm text-slate-500">
            {search ? `Nothing matches “${query}”.` : 'Nothing in this group yet.'}
          </p>
        )}
        {visible.map((row) => (
          <div key={row.key} className="flex flex-wrap items-center gap-3 py-3.5 first:pt-1 last:pb-1">
            <div className="min-w-0 flex-1">
              <label htmlFor={`setting-${row.key}`} className="block text-sm font-medium text-slate-200">
                {row.label}
              </label>
              {row.help && <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">{row.help}</p>}
              {/* the raw key is for support, not for reading: it leads no row,
                  but a search is exactly when someone is looking for one */}
              {search && (
                <p className="mt-0.5 font-mono text-[10px] text-slate-500">
                  {GROUP_LABELS[row.group] ?? row.group} · {row.key}
                </p>
              )}
            </div>

            {row.type === 'boolean' ? (
              <button
                id={`setting-${row.key}`}
                role="switch"
                aria-checked={Boolean(row.value)}
                onClick={() => void toggle(row, !row.value)}
                className={`relative h-6 w-11 shrink-0 rounded-full transition ${
                  row.value ? 'bg-up-solid' : 'bg-ink-500'
                }`}
              >
                <span
                  className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${
                    row.value ? 'left-[1.375rem]' : 'left-0.5'
                  }`}
                />
              </button>
            ) : (
              <input
                id={`setting-${row.key}`}
                value={display(row)}
                inputMode={row.type === 'number' ? 'decimal' : 'text'}
                onChange={(event) => setDraft((current) => ({ ...current, [row.key]: event.target.value }))}
                className="field w-full sm:w-64"
              />
            )}

            {row.overridden && (
              <button onClick={() => void reset(row)} className="btn-ghost !px-2.5 !py-1.5 text-[11px]">
                Reset
              </button>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
