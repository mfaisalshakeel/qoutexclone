import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, api } from '../../lib/api';
import { toast } from '../../store/toast';
import { Loading, PageHead } from '../../components/admin/ui';
import type { Asset, Candle } from '../../lib/types';

interface OtcParams {
  baseVolatility: number;
  garchAlpha: number;
  garchBeta: number;
  trendShare: number;
  regimeMinMinutes: number;
  regimeMaxMinutes: number;
  trendStrength: number;
  meanReversion: number;
  anchorDriftPerHour: number;
  spikeProbability: number;
  spikeSigmaMultiple: number;
  maxTickMove: number;
  tickMs: number;
  followSpot: boolean;
}

interface Field {
  key: keyof OtcParams;
  label: string;
  help: string;
  step: number;
}

const FIELDS: Field[] = [
  {
    key: 'baseVolatility',
    label: 'Base volatility (per minute)',
    help: 'Long-run standard deviation of returns.',
    step: 0.0001,
  },
  {
    key: 'garchAlpha',
    label: 'Shock weight (α)',
    help: 'How strongly the last move raises volatility.',
    step: 0.01,
  },
  {
    key: 'garchBeta',
    label: 'Volatility persistence (β)',
    help: 'How long a volatile patch lasts.',
    step: 0.01,
  },
  {
    key: 'trendShare',
    label: 'Time spent trending',
    help: '0 = always ranging, 1 = always trending.',
    step: 0.05,
  },
  {
    key: 'regimeMinMinutes',
    label: 'Shortest regime (minutes)',
    help: 'Minimum length of a trend or range.',
    step: 0.5,
  },
  {
    key: 'regimeMaxMinutes',
    label: 'Longest regime (minutes)',
    help: 'Maximum length of a trend or range.',
    step: 1,
  },
  {
    key: 'trendStrength',
    label: 'Trend strength',
    help: 'Drift while trending, as a multiple of tick sigma.',
    step: 0.05,
  },
  {
    key: 'meanReversion',
    label: 'Mean reversion',
    help: 'Pull back toward the anchor each tick.',
    step: 0.0005,
  },
  {
    key: 'anchorDriftPerHour',
    label: 'Anchor drift (per hour)',
    help: 'How fast the anchor itself wanders.',
    step: 0.0005,
  },
  {
    key: 'spikeProbability',
    label: 'Spike chance (per tick)',
    help: 'Frequency of sudden jumps.',
    step: 0.0001,
  },
  { key: 'spikeSigmaMultiple', label: 'Spike size (× sigma)', help: 'How large a spike can be.', step: 0.5 },
  {
    key: 'maxTickMove',
    label: 'Max move per tick',
    help: 'Hard cap, as a fraction of price. Prevents gaps.',
    step: 0.0005,
  },
  { key: 'tickMs', label: 'Tick interval (ms)', help: 'How often this market prints a price.', step: 50 },
];

/** Candle preview drawn inline — no chart library needed for 120 bars. */
function Preview({ candles }: { candles: Candle[] }) {
  const { bars, high, low } = useMemo(() => {
    const highs = candles.map((candle) => candle.high);
    const lows = candles.map((candle) => candle.low);
    return { bars: candles, high: Math.max(...highs), low: Math.min(...lows) };
  }, [candles]);

  if (bars.length === 0) return null;
  const range = high - low || 1;
  const width = 900;
  const height = 260;
  const step = width / bars.length;
  const y = (value: number) => height - ((value - low) / range) * (height - 20) - 10;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-64 w-full"
      role="img"
      aria-label="Generated price preview"
    >
      {bars.map((candle, index) => {
        const x = index * step + step / 2;
        const up = candle.close >= candle.open;
        const colour = up ? '#12b886' : '#f0455e';
        return (
          <g key={candle.time}>
            <line x1={x} x2={x} y1={y(candle.high)} y2={y(candle.low)} stroke={colour} strokeWidth="1" />
            <rect
              x={x - Math.max(step * 0.3, 1)}
              width={Math.max(step * 0.6, 1.5)}
              y={y(Math.max(candle.open, candle.close))}
              height={Math.max(Math.abs(y(candle.open) - y(candle.close)), 1)}
              fill={colour}
            />
          </g>
        );
      })}
    </svg>
  );
}

/** Per-market tuning for the broker price engine, with a preview before saving. */
export function AdminOtcEngine() {
  const [markets, setMarkets] = useState<Asset[] | null>(null);
  const [symbol, setSymbol] = useState<string>('');
  const [effective, setEffective] = useState<OtcParams | null>(null);
  const [overrides, setOverrides] = useState<Partial<OtcParams>>({});
  const [candles, setCandles] = useState<Candle[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .get<{ assets: Asset[] }>('/admin/assets')
      .then(({ assets }) => {
        setMarkets(assets);
        setSymbol(
          (current) => current || assets.find((asset) => asset.isOtc)?.symbol || assets[0]?.symbol || '',
        );
      })
      .catch(() => setMarkets([]));
  }, []);

  const loadMarket = useCallback(async (target: string) => {
    if (!target) return;
    const data = await api.get<{ effective: OtcParams; overrides: Partial<OtcParams> }>(
      `/admin/otc/${target}`,
    );
    setEffective(data.effective);
    setOverrides(data.overrides ?? {});
  }, []);

  const preview = useCallback(async (target: string, values: Partial<OtcParams>) => {
    if (!target) return;
    try {
      const data = await api.post<{ candles: Candle[] }>(`/admin/otc/${target}/preview`, {
        overrides: values,
        candles: 120,
      });
      setCandles(data.candles);
    } catch (err) {
      toast.error('Preview failed', err instanceof ApiError ? err.message : undefined);
    }
  }, []);

  useEffect(() => {
    if (!symbol) return;
    void loadMarket(symbol).then(() => preview(symbol, {}));
  }, [symbol, loadMarket, preview]);

  const merged = { ...(effective ?? {}), ...overrides } as OtcParams;

  const save = async () => {
    setBusy(true);
    try {
      const data = await api.put<{ effective: OtcParams }>(`/admin/otc/${symbol}`, {
        overrides: Object.keys(overrides).length ? overrides : null,
      });
      setEffective(data.effective);
      toast.success('Engine updated', 'The live feed is already using it');
    } catch (err) {
      toast.error('Could not save', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    setOverrides({});
    try {
      await api.put(`/admin/otc/${symbol}`, { overrides: null });
      await loadMarket(symbol);
      await preview(symbol, {});
      toast.info('Restored the market defaults');
    } catch (err) {
      toast.error('Could not reset', err instanceof ApiError ? err.message : undefined);
    }
  };

  if (!markets) {
    return (
      <>
        <PageHead title="Price engine" />
        <Loading />
      </>
    );
  }

  return (
    <>
      <PageHead
        title="Price engine"
        subtitle="Per-market parameters for broker-priced feeds. Prices never depend on open positions."
        action={
          <div className="flex gap-2">
            <button onClick={() => void preview(symbol, overrides)} className="btn-ghost text-xs">
              Preview
            </button>
            <button onClick={() => void reset()} className="btn-ghost text-xs">
              Reset
            </button>
            <button onClick={() => void save()} disabled={busy} className="btn-primary text-xs">
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        }
      />

      <div className="mb-4">
        <label className="label" htmlFor="otc-market">
          Market
        </label>
        <select
          id="otc-market"
          value={symbol}
          onChange={(event) => setSymbol(event.target.value)}
          className="field w-full sm:w-80"
        >
          {markets.map((market) => (
            <option key={market.symbol} value={market.symbol}>
              {/* pair already carries the (OTC) suffix for broker markets */}
              {market.pair}
            </option>
          ))}
        </select>
      </div>

      <div className="card mb-4 p-3">
        <p className="mb-2 text-xs text-slate-400">
          Preview of 120 one-minute candles generated from these parameters, from a fresh seed.
        </p>
        {candles.length === 0 ? <Loading /> : <Preview candles={candles} />}
      </div>

      {effective && (
        <div className="card p-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FIELDS.map((field) => (
              <div key={field.key}>
                <label className="label" htmlFor={`otc-${field.key}`}>
                  {field.label}
                </label>
                <input
                  id={`otc-${field.key}`}
                  type="number"
                  step={field.step}
                  value={String(merged[field.key] ?? '')}
                  onChange={(event) =>
                    setOverrides((current) => ({ ...current, [field.key]: Number(event.target.value) }))
                  }
                  className="field"
                />
                <p className="mt-1 text-[11px] text-slate-500">{field.help}</p>
              </div>
            ))}

            <div>
              <span className="label">Follow the real market</span>
              <button
                role="switch"
                aria-checked={Boolean(merged.followSpot)}
                onClick={() => setOverrides((current) => ({ ...current, followSpot: !merged.followSpot }))}
                className={`relative h-6 w-11 rounded-full transition ${merged.followSpot ? 'bg-up' : 'bg-ink-500'}`}
              >
                <span
                  className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${
                    merged.followSpot ? 'left-[1.375rem]' : 'left-0.5'
                  }`}
                />
              </button>
              <p className="mt-1 text-[11px] text-slate-500">
                When the matching exchange market is open, the anchor eases toward its price.
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
