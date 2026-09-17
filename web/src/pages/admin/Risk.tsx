import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, api } from '../../lib/api';
import { toast } from '../../store/toast';
import { Empty, Loading, PageHead, StatCard, Table, Td } from '../../components/admin/ui';

const REFRESH_MS = 5_000;

interface Limits {
  minStake: number;
  maxStake: number;
  maxOpenStakePerUser: number;
  maxExposurePerDirection: number;
}

interface MarketRisk {
  assetId: string;
  symbol: string;
  pair: string;
  assetClass: string;
  payoutPct: number;
  limits: Limits;
  up: number;
  down: number;
  net: number;
  openPositions: number;
  traders: number;
  liabilityUp: number;
  liabilityDown: number;
  utilisation: number | null;
  roomUp: number | null;
  roomDown: number | null;
}

interface Payload {
  markets: MarketRisk[];
  totals: { up: number; down: number; net: number; openPositions: number; liability: number };
  defaults: { maxOpenStakePerUser: number; maxExposurePerDirection: number };
}

const money = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

/** 0 means "fall back to the default", which is worth saying rather than showing "$0". */
const limit = (cents: number, fallback: number) => {
  if (cents > 0) return money(cents);
  return fallback > 0 ? `${money(fallback)} (default)` : 'No limit';
};

/**
 * The risk book: what the house holds open on each market, and the limits that
 * cap it. Limits reject *new* stakes. They never move a price, a payout or an
 * outcome — a trader inside every limit gets the same market as everyone else.
 */
export function AdminRisk() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [onlyOpen, setOnlyOpen] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Limits | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const next = await api.get<Payload>('/admin/risk');
      setData(next);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the risk book');
    }
  }, []);

  useEffect(() => {
    void load();
    // an open book is watched, so it refreshes itself
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  const markets = useMemo(() => data?.markets ?? [], [data]);
  const shown = useMemo(
    () => (onlyOpen ? markets.filter((market) => market.openPositions > 0) : markets),
    [markets, onlyOpen],
  );
  const capped = useMemo(
    () => markets.filter((market) => market.utilisation !== null && market.utilisation >= 0.8),
    [markets],
  );

  const save = async (market: MarketRisk) => {
    if (!draft) return;
    setSaving(true);
    try {
      await api.put(`/admin/risk/${market.symbol}`, draft);
      toast.success(`${market.pair} limits updated`);
      setEditing(null);
      setDraft(null);
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not save the limits');
    } finally {
      setSaving(false);
    }
  };

  if (error && !data) {
    return (
      <div className="space-y-4">
        <PageHead title="Risk" subtitle="Live exposure and the limits on new positions" />
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
        <PageHead title="Risk" subtitle="Live exposure and the limits on new positions" />
        <Loading rows={6} cols={6} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHead
        title="Risk"
        subtitle="Live-money exposure only. Limits reject new stakes; they never change a price."
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Open on UP" value={money(data.totals.up)} />
        <StatCard label="Open on DOWN" value={money(data.totals.down)} />
        <StatCard
          label="Net direction"
          value={`${data.totals.net >= 0 ? '+' : '−'}${money(Math.abs(data.totals.net))}`}
        />
        <StatCard
          label="Worst-case payout"
          value={money(data.totals.liability)}
          hint={`${data.totals.openPositions} open positions`}
        />
      </div>

      {capped.length > 0 && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100">
          <p className="font-semibold">
            {capped.length} market{capped.length === 1 ? '' : 's'} at 80% of a side limit or more
          </p>
          <p className="mt-1 text-xs text-amber-200/80">
            {capped.map((market) => market.pair).join(', ')}. New stakes on the full side are refused with a
            message pointing the trader at the other direction.
          </p>
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-white">Markets</h3>
        <label className="flex items-center gap-2 text-xs text-slate-300">
          <input
            type="checkbox"
            checked={onlyOpen}
            onChange={(event) => setOnlyOpen(event.target.checked)}
            className="h-4 w-4 rounded border-ink-500 bg-ink-900"
          />
          Only markets with open positions
        </label>
      </div>

      {shown.length === 0 ? (
        <Empty text={onlyOpen ? 'No live-money positions are open right now.' : 'No markets are enabled.'} />
      ) : (
        <Table head={['Market', 'UP', 'DOWN', 'Net', 'Side limit', 'Per trader', '']}>
          {shown.map((market) => {
            const isEditing = editing === market.symbol && draft;
            return (
              <tr key={market.assetId} className="border-t border-ink-700">
                <Td>
                  <div className="min-w-0">
                    <p className="truncate font-medium text-white">{market.pair}</p>
                    <p className="text-xs text-slate-500">
                      {market.openPositions} open · {market.traders} trader
                      {market.traders === 1 ? '' : 's'} · {market.payoutPct}%
                    </p>
                  </div>
                </Td>
                <Td>
                  <span className="text-up">{money(market.up)}</span>
                  {market.roomUp !== null && (
                    <p className="text-[11px] text-slate-500">{money(market.roomUp)} left</p>
                  )}
                </Td>
                <Td>
                  <span className="text-down">{money(market.down)}</span>
                  {market.roomDown !== null && (
                    <p className="text-[11px] text-slate-500">{money(market.roomDown)} left</p>
                  )}
                </Td>
                <Td className={market.net >= 0 ? 'text-up' : 'text-down'}>
                  {market.net >= 0 ? '+' : '−'}
                  {money(Math.abs(market.net))}
                </Td>

                {isEditing ? (
                  <>
                    <Td>
                      <input
                        type="number"
                        min={0}
                        step={100}
                        aria-label={`${market.pair} side limit in cents`}
                        value={draft.maxExposurePerDirection}
                        onChange={(event) =>
                          setDraft({ ...draft, maxExposurePerDirection: Number(event.target.value) })
                        }
                        className="w-28 rounded-lg border border-ink-500 bg-ink-900 px-2 py-1.5 text-xs text-white"
                      />
                    </Td>
                    <Td>
                      <input
                        type="number"
                        min={0}
                        step={100}
                        aria-label={`${market.pair} per-trader limit in cents`}
                        value={draft.maxOpenStakePerUser}
                        onChange={(event) =>
                          setDraft({ ...draft, maxOpenStakePerUser: Number(event.target.value) })
                        }
                        className="w-28 rounded-lg border border-ink-500 bg-ink-900 px-2 py-1.5 text-xs text-white"
                      />
                    </Td>
                    <Td>
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          onClick={() => void save(market)}
                          disabled={saving}
                          className="rounded-md bg-accent px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-50"
                        >
                          {saving ? 'Saving…' : 'Save'}
                        </button>
                        <button
                          onClick={() => {
                            setEditing(null);
                            setDraft(null);
                          }}
                          className="rounded-md bg-ink-600 px-2.5 py-1 text-xs font-semibold text-slate-200"
                        >
                          Cancel
                        </button>
                      </div>
                    </Td>
                  </>
                ) : (
                  <>
                    <Td className="text-xs text-slate-300">
                      {limit(market.limits.maxExposurePerDirection, data.defaults.maxExposurePerDirection)}
                      {market.utilisation !== null && (
                        <p className="text-[11px] text-slate-500">
                          {Math.round(market.utilisation * 100)}% used
                        </p>
                      )}
                    </Td>
                    <Td className="text-xs text-slate-300">
                      {limit(market.limits.maxOpenStakePerUser, data.defaults.maxOpenStakePerUser)}
                    </Td>
                    <Td>
                      <button
                        onClick={() => {
                          setEditing(market.symbol);
                          setDraft({ ...market.limits });
                        }}
                        className="rounded-md bg-ink-600 px-2.5 py-1 text-xs font-semibold text-slate-200"
                      >
                        Limits
                      </button>
                    </Td>
                  </>
                )}
              </tr>
            );
          })}
        </Table>
      )}

      <p className="text-xs text-slate-500">
        A limit of 0 falls back to the platform default in Settings, and a default of 0 means no limit.
        Practice and tournament positions are not the house&rsquo;s money, so they are never counted here and
        a practice trader is never turned away because live traders filled a book.
      </p>
    </div>
  );
}
