import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, api } from '../../lib/api';
import { toast } from '../../store/toast';
import { Empty, Loading, PageHead, Table, Td } from '../../components/admin/ui';

type RuleKind = 'TIME_OF_DAY' | 'VOLATILITY' | 'SCHEDULE';

interface AppliedRule {
  id: string;
  name: string;
  kind: RuleKind;
  adjustment: number;
}

interface Rule {
  id: string;
  name: string;
  kind: RuleKind;
  assetId: string | null;
  assetClass: string | null;
  adjustment: number;
  config: Record<string, unknown>;
  priority: number;
  exclusive: boolean;
  enabled: boolean;
  asset?: { symbol: string; pair: string } | null;
}

interface MarketRow {
  id: string;
  symbol: string;
  pair: string;
  assetClass: string;
  basePct: number;
  pct: number;
  applied: AppliedRule[];
}

interface Payload {
  rules: Rule[];
  kinds: RuleKind[];
  assetClasses: string[];
  bounds: { min: number; max: number };
  markets: MarketRow[];
}

const KIND_LABEL: Record<RuleKind, string> = {
  TIME_OF_DAY: 'Time of day',
  VOLATILITY: 'Volatility',
  SCHEDULE: 'Scheduled window',
};

const KIND_HELP: Record<RuleKind, string> = {
  TIME_OF_DAY: 'Fires inside a daily window, in UTC. A window may run past midnight.',
  VOLATILITY: "Fires when a market moves more or less than the volatility it's configured for.",
  SCHEDULE: 'Fires once, between two instants — a news release or a maintenance period.',
};

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "13:30" ⇄ minutes from midnight, so the form can use a time input. */
function toTime(minutes: number): string {
  const wrapped = ((Math.floor(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`;
}

function fromTime(value: string): number {
  const [hours, minutes] = value.split(':').map((part) => Number(part) || 0);
  return hours * 60 + minutes;
}

/** A datetime-local value for an ISO instant, kept in UTC to match the server. */
function toLocalInput(iso: string): string {
  return iso.slice(0, 16);
}

interface Draft {
  id: string | null;
  name: string;
  kind: RuleKind;
  scope: string;
  adjustment: number;
  priority: number;
  exclusive: boolean;
  enabled: boolean;
  days: number[];
  fromMinute: number;
  toMinute: number;
  windowMinutes: number;
  aboveRatio: string;
  belowRatio: string;
  from: string;
  to: string;
}

function emptyDraft(): Draft {
  const now = new Date();
  const start = new Date(now.getTime() + 3_600_000).toISOString();
  const end = new Date(now.getTime() + 5_400_000).toISOString();
  return {
    id: null,
    name: '',
    kind: 'TIME_OF_DAY',
    scope: 'all',
    adjustment: -5,
    priority: 0,
    exclusive: false,
    enabled: true,
    days: [],
    fromMinute: 22 * 60,
    toMinute: 6 * 60,
    windowMinutes: 15,
    aboveRatio: '1.5',
    belowRatio: '',
    from: toLocalInput(start),
    to: toLocalInput(end),
  };
}

function draftOf(rule: Rule): Draft {
  const base = emptyDraft();
  const config = rule.config ?? {};
  return {
    ...base,
    id: rule.id,
    name: rule.name,
    kind: rule.kind,
    scope: rule.assetId ? `asset:${rule.assetId}` : rule.assetClass ? `class:${rule.assetClass}` : 'all',
    adjustment: rule.adjustment,
    priority: rule.priority,
    exclusive: rule.exclusive,
    enabled: rule.enabled,
    days: (config.days as number[] | undefined) ?? [],
    fromMinute: (config.fromMinute as number | undefined) ?? base.fromMinute,
    toMinute: (config.toMinute as number | undefined) ?? base.toMinute,
    windowMinutes: (config.windowMinutes as number | undefined) ?? base.windowMinutes,
    aboveRatio: config.aboveRatio == null ? '' : String(config.aboveRatio),
    belowRatio: config.belowRatio == null ? '' : String(config.belowRatio),
    from: config.from ? toLocalInput(String(config.from)) : base.from,
    to: config.to ? toLocalInput(String(config.to)) : base.to,
  };
}

/** The request body for a draft, shaped by its kind. */
function bodyOf(draft: Draft) {
  const config =
    draft.kind === 'TIME_OF_DAY'
      ? { days: draft.days, fromMinute: draft.fromMinute, toMinute: draft.toMinute }
      : draft.kind === 'VOLATILITY'
        ? {
            windowMinutes: draft.windowMinutes,
            ...(draft.aboveRatio.trim() ? { aboveRatio: Number(draft.aboveRatio) } : {}),
            ...(draft.belowRatio.trim() ? { belowRatio: Number(draft.belowRatio) } : {}),
          }
        : { from: `${draft.from}:00.000Z`, to: `${draft.to}:00.000Z` };

  return {
    name: draft.name.trim(),
    kind: draft.kind,
    assetId: draft.scope.startsWith('asset:') ? draft.scope.slice(6) : null,
    assetClass: draft.scope.startsWith('class:') ? draft.scope.slice(6) : null,
    adjustment: draft.adjustment,
    priority: draft.priority,
    exclusive: draft.exclusive,
    enabled: draft.enabled,
    config,
  };
}

/**
 * Payout rules: the base payout a market carries, and the adjustments that move
 * it. Nothing here can look at a trader or a position — a payout belongs to the
 * market and the moment, and what it resolves to is locked into the trade.
 */
export function AdminPayouts() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [previewSymbol, setPreviewSymbol] = useState('');
  const [preview, setPreview] = useState<{ pct: number; basePct: number; applied: AppliedRule[] } | null>(
    null,
  );

  const load = useCallback(async () => {
    try {
      setError(null);
      setData(await api.get<Payload>('/admin/payout-rules'));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load payout rules');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // a fresh [] on every render would re-run the memo and the effect below it
  const markets = useMemo(() => data?.markets ?? [], [data]);
  const adjusted = useMemo(() => markets.filter((market) => market.applied.length > 0), [markets]);

  useEffect(() => {
    if (!previewSymbol && markets.length) setPreviewSymbol(markets[0].symbol);
  }, [markets, previewSymbol]);

  const runPreview = async () => {
    if (!previewSymbol) return;
    try {
      setPreview(
        await api.post('/admin/payout-rules/preview', {
          symbol: previewSymbol,
          ...(draft ? { rule: bodyOf(draft) } : {}),
        }),
      );
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Preview failed');
    }
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const body = bodyOf(draft);
      if (draft.id) await api.put(`/admin/payout-rules/${draft.id}`, body);
      else await api.post('/admin/payout-rules', body);
      toast.success(draft.id ? 'Rule updated' : 'Rule created');
      setDraft(null);
      setPreview(null);
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not save the rule');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (rule: Rule) => {
    try {
      await api.del(`/admin/payout-rules/${rule.id}`);
      toast.success('Rule deleted');
      setConfirming(null);
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not delete the rule');
    }
  };

  const toggle = async (rule: Rule) => {
    try {
      await api.put(`/admin/payout-rules/${rule.id}`, {
        ...bodyOf(draftOf(rule)),
        enabled: !rule.enabled,
      });
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not update the rule');
    }
  };

  if (error) {
    return (
      <div className="space-y-4">
        <PageHead title="Payouts" subtitle="Base payouts and the rules that adjust them" />
        <div className="rounded-xl border border-down/40 bg-down/10 p-6 text-sm text-slate-200">
          <p>{error}</p>
          <button
            onClick={() => void load()}
            className="mt-3 rounded-lg bg-ink-600 px-3 py-1.5 text-xs font-semibold text-white"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-4">
        <PageHead title="Payouts" subtitle="Base payouts and the rules that adjust them" />
        <Loading rows={6} cols={5} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHead
        title="Payouts"
        subtitle={`Adjustments are clamped to ${data.bounds.min}–${data.bounds.max}%`}
        action={
          <button
            onClick={() => {
              setDraft(emptyDraft());
              setPreview(null);
            }}
            className="rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-white"
          >
            New rule
          </button>
        }
      />

      {draft && (
        <section className="rounded-xl border border-ink-500 bg-ink-800 p-4">
          <h3 className="text-sm font-semibold text-white">{draft.id ? 'Edit rule' : 'New rule'}</h3>
          <p className="mt-1 text-xs text-slate-400">{KIND_HELP[draft.kind]}</p>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="block min-w-0">
              <span className="text-xs font-medium text-slate-300">Name</span>
              <input
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                placeholder="Quiet Asian session"
                className="mt-1 w-full rounded-lg border border-ink-500 bg-ink-900 px-3 py-2 text-sm text-white"
              />
            </label>

            <label className="block min-w-0">
              <span className="text-xs font-medium text-slate-300">Kind</span>
              <select
                value={draft.kind}
                onChange={(event) => setDraft({ ...draft, kind: event.target.value as RuleKind })}
                className="mt-1 w-full rounded-lg border border-ink-500 bg-ink-900 px-3 py-2 text-sm text-white"
              >
                {data.kinds.map((kind) => (
                  <option key={kind} value={kind}>
                    {KIND_LABEL[kind]}
                  </option>
                ))}
              </select>
            </label>

            <label className="block min-w-0">
              <span className="text-xs font-medium text-slate-300">Applies to</span>
              <select
                value={draft.scope}
                onChange={(event) => setDraft({ ...draft, scope: event.target.value })}
                className="mt-1 w-full rounded-lg border border-ink-500 bg-ink-900 px-3 py-2 text-sm text-white"
              >
                <option value="all">Every market</option>
                {data.assetClasses.map((assetClass) => (
                  <option key={assetClass} value={`class:${assetClass}`}>
                    All {assetClass.toLowerCase()}
                  </option>
                ))}
                {markets.map((market) => (
                  <option key={market.id} value={`asset:${market.id}`}>
                    {market.pair}
                  </option>
                ))}
              </select>
            </label>

            <label className="block min-w-0">
              <span className="text-xs font-medium text-slate-300">Adjustment (points)</span>
              <input
                type="number"
                step={1}
                value={draft.adjustment}
                onChange={(event) => setDraft({ ...draft, adjustment: Number(event.target.value) })}
                className="mt-1 w-full rounded-lg border border-ink-500 bg-ink-900 px-3 py-2 text-sm text-white"
              />
            </label>

            <label className="block min-w-0">
              <span className="text-xs font-medium text-slate-300">Priority</span>
              <input
                type="number"
                step={1}
                min={0}
                value={draft.priority}
                onChange={(event) => setDraft({ ...draft, priority: Number(event.target.value) })}
                className="mt-1 w-full rounded-lg border border-ink-500 bg-ink-900 px-3 py-2 text-sm text-white"
              />
              <span className="mt-1 block text-[11px] text-slate-500">Lower runs first.</span>
            </label>

            <div className="flex items-end gap-4">
              <label className="flex items-center gap-2 text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={draft.exclusive}
                  onChange={(event) => setDraft({ ...draft, exclusive: event.target.checked })}
                  className="h-4 w-4 rounded border-ink-500 bg-ink-900"
                />
                Stop later rules
              </label>
              <label className="flex items-center gap-2 text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={draft.enabled}
                  onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })}
                  className="h-4 w-4 rounded border-ink-500 bg-ink-900"
                />
                Enabled
              </label>
            </div>
          </div>

          {draft.kind === 'TIME_OF_DAY' && (
            <fieldset className="mt-4 rounded-lg border border-ink-600 p-3">
              <legend className="px-1 text-xs font-semibold text-slate-300">Daily window (UTC)</legend>
              <div className="flex flex-wrap items-end gap-3">
                <label className="block">
                  <span className="text-xs text-slate-400">From</span>
                  <input
                    type="time"
                    value={toTime(draft.fromMinute)}
                    onChange={(event) => setDraft({ ...draft, fromMinute: fromTime(event.target.value) })}
                    className="mt-1 rounded-lg border border-ink-500 bg-ink-900 px-3 py-2 text-sm text-white"
                  />
                </label>
                <label className="block">
                  <span className="text-xs text-slate-400">To</span>
                  <input
                    type="time"
                    value={toTime(draft.toMinute)}
                    onChange={(event) => setDraft({ ...draft, toMinute: fromTime(event.target.value) })}
                    className="mt-1 rounded-lg border border-ink-500 bg-ink-900 px-3 py-2 text-sm text-white"
                  />
                </label>
                <div className="min-w-0">
                  <span className="text-xs text-slate-400">Days (none = every day)</span>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {DAYS.map((day, index) => {
                      const on = draft.days.includes(index);
                      return (
                        <button
                          key={day}
                          type="button"
                          aria-pressed={on}
                          onClick={() =>
                            setDraft({
                              ...draft,
                              days: on
                                ? draft.days.filter((value) => value !== index)
                                : [...draft.days, index].sort(),
                            })
                          }
                          className={`rounded-md px-2 py-1.5 text-xs font-semibold ${
                            on ? 'bg-accent text-white' : 'bg-ink-700 text-slate-300'
                          }`}
                        >
                          {day}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </fieldset>
          )}

          {draft.kind === 'VOLATILITY' && (
            <fieldset className="mt-4 rounded-lg border border-ink-600 p-3">
              <legend className="px-1 text-xs font-semibold text-slate-300">
                Measured against the market&rsquo;s own volatility
              </legend>
              <div className="flex flex-wrap items-end gap-3">
                <label className="block">
                  <span className="text-xs text-slate-400">Lookback (minutes)</span>
                  <input
                    type="number"
                    min={2}
                    max={240}
                    value={draft.windowMinutes}
                    onChange={(event) => setDraft({ ...draft, windowMinutes: Number(event.target.value) })}
                    className="mt-1 w-32 rounded-lg border border-ink-500 bg-ink-900 px-3 py-2 text-sm text-white"
                  />
                </label>
                <label className="block">
                  <span className="text-xs text-slate-400">Moving more than (×)</span>
                  <input
                    type="number"
                    step={0.1}
                    value={draft.aboveRatio}
                    onChange={(event) => setDraft({ ...draft, aboveRatio: event.target.value })}
                    placeholder="1.5"
                    className="mt-1 w-32 rounded-lg border border-ink-500 bg-ink-900 px-3 py-2 text-sm text-white"
                  />
                </label>
                <label className="block">
                  <span className="text-xs text-slate-400">Moving less than (×)</span>
                  <input
                    type="number"
                    step={0.1}
                    value={draft.belowRatio}
                    onChange={(event) => setDraft({ ...draft, belowRatio: event.target.value })}
                    placeholder="0.5"
                    className="mt-1 w-32 rounded-lg border border-ink-500 bg-ink-900 px-3 py-2 text-sm text-white"
                  />
                </label>
              </div>
              <p className="mt-2 text-[11px] text-slate-500">
                Set at least one threshold. A market with too little history to measure does not fire the
                rule.
              </p>
            </fieldset>
          )}

          {draft.kind === 'SCHEDULE' && (
            <fieldset className="mt-4 rounded-lg border border-ink-600 p-3">
              <legend className="px-1 text-xs font-semibold text-slate-300">One-off window (UTC)</legend>
              <div className="flex flex-wrap items-end gap-3">
                <label className="block">
                  <span className="text-xs text-slate-400">Starts</span>
                  <input
                    type="datetime-local"
                    value={draft.from}
                    onChange={(event) => setDraft({ ...draft, from: event.target.value })}
                    className="mt-1 rounded-lg border border-ink-500 bg-ink-900 px-3 py-2 text-sm text-white"
                  />
                </label>
                <label className="block">
                  <span className="text-xs text-slate-400">Ends</span>
                  <input
                    type="datetime-local"
                    value={draft.to}
                    onChange={(event) => setDraft({ ...draft, to: event.target.value })}
                    className="mt-1 rounded-lg border border-ink-500 bg-ink-900 px-3 py-2 text-sm text-white"
                  />
                </label>
              </div>
            </fieldset>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              onClick={() => void save()}
              disabled={saving || draft.name.trim().length < 2}
              className="rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
            >
              {saving ? 'Saving…' : draft.id ? 'Save changes' : 'Create rule'}
            </button>
            <button
              onClick={() => {
                setDraft(null);
                setPreview(null);
              }}
              className="rounded-lg bg-ink-600 px-4 py-2 text-xs font-semibold text-slate-200"
            >
              Cancel
            </button>

            <div className="ml-auto flex items-center gap-2">
              <select
                value={previewSymbol}
                onChange={(event) => setPreviewSymbol(event.target.value)}
                aria-label="Market to preview"
                className="rounded-lg border border-ink-500 bg-ink-900 px-3 py-2 text-xs text-white"
              >
                {markets.map((market) => (
                  <option key={market.id} value={market.symbol}>
                    {market.pair}
                  </option>
                ))}
              </select>
              <button
                onClick={() => void runPreview()}
                className="rounded-lg bg-ink-600 px-3 py-2 text-xs font-semibold text-slate-200"
              >
                Preview now
              </button>
            </div>
          </div>

          {preview && (
            <div className="mt-3 rounded-lg border border-ink-600 bg-ink-900 p-3 text-xs text-slate-300">
              <p>
                <span className="font-semibold text-white">{preview.pct}%</span> right now (base{' '}
                {preview.basePct}%)
              </p>
              {preview.applied.length === 0 ? (
                <p className="mt-1 text-slate-500">No rule fires at this instant.</p>
              ) : (
                <ul className="mt-1 space-y-0.5">
                  {preview.applied.map((rule) => (
                    <li key={rule.id}>
                      {rule.name} ({KIND_LABEL[rule.kind]}){' '}
                      <span className={rule.adjustment < 0 ? 'text-down' : 'text-up'}>
                        {rule.adjustment > 0 ? '+' : ''}
                        {rule.adjustment}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>
      )}

      <section>
        <h3 className="mb-2 text-sm font-semibold text-white">Rules</h3>
        {data.rules.length === 0 ? (
          <Empty text="No payout rules yet. Every market pays its base payout." />
        ) : (
          <Table head={['Rule', 'Applies to', 'When', 'Adjustment', '']}>
            {data.rules.map((rule) => (
              <tr key={rule.id} className="border-t border-ink-700">
                <Td>
                  <div className="min-w-0">
                    <p className="truncate font-medium text-white">{rule.name}</p>
                    <p className="text-xs text-slate-500">
                      {KIND_LABEL[rule.kind]}
                      {rule.exclusive && ' · stops later rules'}
                      {!rule.enabled && ' · disabled'}
                    </p>
                  </div>
                </Td>
                <Td>
                  {rule.asset
                    ? rule.asset.pair
                    : rule.assetClass
                      ? `All ${rule.assetClass.toLowerCase()}`
                      : 'Every market'}
                </Td>
                <Td className="text-xs text-slate-400">{describeRule(rule)}</Td>
                <Td>
                  <span className={rule.adjustment < 0 ? 'text-down' : 'text-up'}>
                    {rule.adjustment > 0 ? '+' : ''}
                    {rule.adjustment} pts
                  </span>
                </Td>
                <Td>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      onClick={() => {
                        setDraft(draftOf(rule));
                        setPreview(null);
                      }}
                      className="rounded-md bg-ink-600 px-2.5 py-1 text-xs font-semibold text-slate-200"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => void toggle(rule)}
                      className="rounded-md bg-ink-600 px-2.5 py-1 text-xs font-semibold text-slate-200"
                    >
                      {rule.enabled ? 'Disable' : 'Enable'}
                    </button>
                    {/* two steps rather than a native confirm: it reads better
                        and it is a real, reachable control */}
                    {confirming === rule.id ? (
                      <>
                        <button
                          onClick={() => void remove(rule)}
                          className="rounded-md bg-down px-2.5 py-1 text-xs font-semibold text-white"
                        >
                          Confirm delete
                        </button>
                        <button
                          onClick={() => setConfirming(null)}
                          className="rounded-md bg-ink-600 px-2.5 py-1 text-xs font-semibold text-slate-200"
                        >
                          Keep
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => setConfirming(rule.id)}
                        className="rounded-md bg-down/20 px-2.5 py-1 text-xs font-semibold text-down"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-white">
          Markets paying something other than their base ({adjusted.length})
        </h3>
        {adjusted.length === 0 ? (
          <Empty text="Every market is paying its base payout right now." />
        ) : (
          <Table head={['Market', 'Base', 'Now', 'Why']}>
            {adjusted.map((market) => (
              <tr key={market.id} className="border-t border-ink-700">
                <Td className="font-medium text-white">{market.pair}</Td>
                <Td>{market.basePct}%</Td>
                <Td>
                  <span className={market.pct < market.basePct ? 'text-down' : 'text-up'}>{market.pct}%</span>
                </Td>
                <Td className="text-xs text-slate-400">
                  {market.applied.map((rule) => rule.name).join(', ')}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </section>
    </div>
  );
}

/** A one-line, human description of when a rule fires. */
function describeRule(rule: Rule): string {
  const config = (rule.config ?? {}) as Record<string, unknown>;
  if (rule.kind === 'TIME_OF_DAY') {
    const days = (config.days as number[] | undefined) ?? [];
    const when = days.length ? days.map((day) => DAYS[day]).join(' ') : 'daily';
    return `${when} ${toTime(Number(config.fromMinute ?? 0))}–${toTime(Number(config.toMinute ?? 0))} UTC`;
  }
  if (rule.kind === 'VOLATILITY') {
    const parts: string[] = [];
    if (config.aboveRatio != null) parts.push(`moving > ${config.aboveRatio}×`);
    if (config.belowRatio != null) parts.push(`moving < ${config.belowRatio}×`);
    return `${parts.join(' or ')} over ${config.windowMinutes ?? 15}m`;
  }
  return `${String(config.from ?? '').slice(0, 16)} → ${String(config.to ?? '').slice(0, 16)} UTC`;
}
