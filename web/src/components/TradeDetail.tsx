import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api } from '../lib/api';
import { dateTime, duration as fmtDuration, money, price as fmtPrice } from '../lib/format';
import type { Candle, Trade } from '../lib/types';
import { Skeleton } from './Skeleton';

interface Snapshot {
  trade: Trade;
  timeframe: string;
  from: number;
  to: number;
  candles: Candle[];
}

interface Props {
  trade: Trade;
  precision: number;
  onClose: () => void;
  onTradeAgain: (tradeId: string) => void | Promise<void>;
  canTradeAgain: boolean;
}

const WIDTH = 520;
const HEIGHT = 200;
const PADDING = { top: 10, right: 46, bottom: 16, left: 8 };

/**
 * What happened to one position.
 *
 * The chart is inline SVG rather than the full charting library: it is a still
 * of a finished trade, so it needs no interaction, and drawing it directly
 * keeps the modal instant and avoids a second chart instance competing with
 * the live ones behind it.
 */
export function TradeDetail({ trade, precision, onClose, onTradeAgain, canTradeAgain }: Props) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      setSnapshot(await api.get<Snapshot>(`/trades/${trade.id}/chart`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load this trade');
    }
  }, [trade.id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const won = trade.status === 'WON';
  const refunded = trade.status === 'REFUNDED';
  const result = refunded ? 'Refunded' : won ? 'Won' : 'Lost';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button onClick={onClose} aria-label="Close trade details" className="absolute inset-0 bg-black/60" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${trade.symbol} ${trade.direction} trade`}
        className="relative max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-ink-500 bg-ink-800 p-4 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-base font-bold text-white">
              <span
                className={`rounded px-1.5 py-0.5 text-[11px] ${
                  trade.direction === 'UP' ? 'bg-up/20 text-up' : 'bg-down/20 text-down'
                }`}
              >
                {trade.direction === 'UP' ? '▲ Higher' : '▼ Lower'}
              </span>
              <span className="truncate">{trade.symbol}</span>
            </h2>
            <p className="mt-0.5 text-xs text-slate-400">
              {dateTime(trade.openedAt)} · {fmtDuration(trade.durationSec)} ·{' '}
              {trade.expiryMode === 'CLOCK' ? 'clock expiry' : 'duration'}
            </p>
          </div>
          <button
            ref={closeRef}
            onClick={onClose}
            className="shrink-0 rounded-lg bg-ink-600 px-2.5 py-1.5 text-xs font-semibold text-slate-200"
          >
            Close
          </button>
        </div>

        <div className="mt-3 rounded-xl border border-ink-600 bg-ink-900 p-2">
          {!snapshot && !error && <Skeleton className="h-[200px] w-full" />}
          {error && (
            <div className="flex h-[200px] flex-col items-center justify-center gap-2 text-xs text-slate-400">
              <p>{error}</p>
              <button
                onClick={() => void load()}
                className="rounded-lg bg-ink-600 px-3 py-1.5 font-semibold text-white"
              >
                Try again
              </button>
            </div>
          )}
          {snapshot && <Snippet snapshot={snapshot} trade={trade} precision={precision} />}
        </div>

        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
          <Fact label="Stake" value={money(trade.stake)} />
          <Fact label="Payout" value={`${trade.payoutPct}%`} />
          <Fact label="Entry" value={fmtPrice(trade.entryPrice, precision)} />
          <Fact label="Exit" value={trade.exitPrice != null ? fmtPrice(trade.exitPrice, precision) : '—'} />
        </dl>

        <div
          className={`mt-3 flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 ${
            refunded ? 'bg-ink-700' : won ? 'bg-up-soft' : 'bg-down-soft'
          }`}
        >
          <span
            className={`text-sm font-bold ${refunded ? 'text-slate-300' : won ? 'text-up' : 'text-down'}`}
          >
            {result}
          </span>
          <span
            className={`tabular text-sm font-bold ${refunded ? 'text-slate-300' : won ? 'text-up' : 'text-down'}`}
          >
            {refunded ? 'Stake returned' : `${trade.profit >= 0 ? '+' : '−'}${money(Math.abs(trade.profit))}`}
          </span>
        </div>

        {canTradeAgain && (
          <button
            onClick={async () => {
              setBusy(true);
              try {
                await onTradeAgain(trade.id);
                onClose();
              } finally {
                setBusy(false);
              }
            }}
            disabled={busy}
            className="mt-3 w-full rounded-lg bg-accent py-2.5 text-xs font-semibold text-white disabled:opacity-50"
          >
            {busy ? 'Placing…' : 'Trade again'}
          </button>
        )}
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="tabular mt-0.5 font-semibold text-slate-100">{value}</dd>
    </div>
  );
}

/**
 * The candles around the trade, with the strike and the exit drawn on.
 *
 * The vertical scale includes the entry and exit prices as well as the candles,
 * so a settle just outside the visible range still lands on the chart instead
 * of being clipped off it.
 */
function Snippet({ snapshot, trade, precision }: { snapshot: Snapshot; trade: Trade; precision: number }) {
  const candles = snapshot.candles;
  if (candles.length === 0) {
    return (
      <div className="flex h-[200px] items-center justify-center text-xs text-slate-500">
        No candles were stored for this window.
      </div>
    );
  }

  const openedAt = Math.floor(new Date(trade.openedAt).getTime() / 1000);
  const settledAt = Math.floor(new Date(trade.expiresAt).getTime() / 1000);

  const prices = [
    ...candles.map((candle) => candle.high),
    ...candles.map((candle) => candle.low),
    trade.entryPrice,
    ...(trade.exitPrice != null ? [trade.exitPrice] : []),
  ];
  const high = Math.max(...prices);
  const low = Math.min(...prices);
  const span = high - low || high * 0.001 || 1;

  const plotWidth = WIDTH - PADDING.left - PADDING.right;
  const plotHeight = HEIGHT - PADDING.top - PADDING.bottom;
  const step = plotWidth / candles.length;
  const bodyWidth = Math.max(Math.min(step * 0.62, 10), 1);

  const y = (value: number) => PADDING.top + ((high - value) / span) * plotHeight;
  const x = (index: number) => PADDING.left + index * step + step / 2;
  // the trade's own span, from the candle that holds the entry to the one that
  // holds the settle
  const indexAt = (time: number) => {
    const at = candles.findIndex((candle) => candle.time >= time);
    return at < 0 ? candles.length - 1 : at;
  };
  const entryIndex = indexAt(openedAt);
  const exitIndex = indexAt(settledAt);

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className="h-[200px] w-full"
      role="img"
      aria-label={`${trade.symbol} from ${dateTime(trade.openedAt)} to ${dateTime(trade.expiresAt)}`}
    >
      {/* the window the position was open for */}
      <rect
        x={x(entryIndex) - step / 2}
        y={PADDING.top}
        width={Math.max((exitIndex - entryIndex + 1) * step, step)}
        height={plotHeight}
        fill="#3d7bff"
        opacity={0.08}
      />

      {candles.map((candle, index) => {
        const rising = candle.close >= candle.open;
        const colour = rising ? '#12b886' : '#f0455e';
        const top = y(Math.max(candle.open, candle.close));
        const bottom = y(Math.min(candle.open, candle.close));
        return (
          <g key={candle.time}>
            <line
              x1={x(index)}
              x2={x(index)}
              y1={y(candle.high)}
              y2={y(candle.low)}
              stroke={colour}
              strokeWidth={1}
            />
            <rect
              x={x(index) - bodyWidth / 2}
              y={top}
              width={bodyWidth}
              height={Math.max(bottom - top, 1)}
              fill={colour}
            />
          </g>
        );
      })}

      {/* strike, and where it settled */}
      <line
        x1={PADDING.left}
        x2={WIDTH - PADDING.right}
        y1={y(trade.entryPrice)}
        y2={y(trade.entryPrice)}
        stroke="#7c8aa5"
        strokeWidth={1}
        strokeDasharray="4 3"
      />
      <text x={WIDTH - PADDING.right + 4} y={y(trade.entryPrice) + 3} fontSize={9} fill="#7c8aa5">
        {fmtPrice(trade.entryPrice, precision)}
      </text>

      {trade.exitPrice != null && (
        <>
          <line
            x1={PADDING.left}
            x2={WIDTH - PADDING.right}
            y1={y(trade.exitPrice)}
            y2={y(trade.exitPrice)}
            stroke={trade.status === 'WON' ? '#12b886' : trade.status === 'LOST' ? '#f0455e' : '#7c8aa5'}
            strokeWidth={1}
          />
          <text
            x={WIDTH - PADDING.right + 4}
            y={y(trade.exitPrice) + 3}
            fontSize={9}
            fill={trade.status === 'WON' ? '#12b886' : trade.status === 'LOST' ? '#f0455e' : '#7c8aa5'}
          >
            {fmtPrice(trade.exitPrice, precision)}
          </text>
        </>
      )}

      <text x={PADDING.left} y={HEIGHT - 4} fontSize={9} fill="#5b6578">
        {snapshot.timeframe} candles
      </text>
    </svg>
  );
}
