import { useCallback, useEffect, useState } from 'react';
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
  type: 'boolean' | 'number' | 'string' | 'numberList';
}

const GROUP_LABELS: Record<string, string> = {
  general: 'General',
  trading: 'Trading',
  wallet: 'Payments',
  growth: 'Growth',
  compliance: 'Compliance',
  security: 'Security',
};

/** Renders itself from the server's settings registry, so new keys need no UI work. */
export function AdminSettings() {
  const [rows, setRows] = useState<SettingRow[] | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
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

      <div className="space-y-4">
        {groups.map((group) => (
          <section key={group} className="card p-4">
            <h2 className="mb-3 text-sm font-semibold">{GROUP_LABELS[group] ?? group}</h2>
            <div className="divide-y divide-ink-700">
              {rows
                .filter((row) => row.group === group)
                .map((row) => (
                  <div key={row.key} className="flex flex-wrap items-center gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <label
                        htmlFor={`setting-${row.key}`}
                        className="block text-sm font-medium text-slate-200"
                      >
                        {row.label}
                      </label>
                      <p className="font-mono text-[10px] text-slate-500">{row.key}</p>
                      {row.help && <p className="mt-0.5 text-[11px] text-slate-500">{row.help}</p>}
                    </div>

                    {row.type === 'boolean' ? (
                      <button
                        id={`setting-${row.key}`}
                        role="switch"
                        aria-checked={Boolean(row.value)}
                        onClick={() => void toggle(row, !row.value)}
                        className={`relative h-6 w-11 shrink-0 rounded-full transition ${
                          row.value ? 'bg-up' : 'bg-ink-500'
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
                        onChange={(event) =>
                          setDraft((current) => ({ ...current, [row.key]: event.target.value }))
                        }
                        className="field w-full sm:w-64"
                      />
                    )}

                    {row.overridden && (
                      <button
                        onClick={() => void reset(row)}
                        className="btn-ghost !px-2.5 !py-1.5 text-[11px]"
                      >
                        Reset
                      </button>
                    )}
                  </div>
                ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
