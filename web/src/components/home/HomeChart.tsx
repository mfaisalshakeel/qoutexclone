import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { realtime } from '../../lib/ws';
import type { Candle } from '../../lib/types';

const SYMBOL = 'BTCUSDT';
const TIMEFRAME = '1m';
const POINTS = 40;

/**
 * The hero's live chart preview: real 1-minute candles for one always-open
 * market, kept current over the same socket the terminal itself uses. No
 * synthetic data — if the feed cannot be reached, the line simply does not
 * appear rather than faking a market that isn't moving.
 */
export function HomeChart({ className = '' }: { className?: string }) {
  const [candles, setCandles] = useState<Candle[] | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    api
      .get<{ candles: Candle[] }>(`/market/candles/${SYMBOL}?timeframe=${TIMEFRAME}&limit=${POINTS}`)
      .then(({ candles: list }) => {
        if (mounted.current) setCandles(list);
      })
      .catch(() => undefined);

    realtime.connect();
    const unsubscribe = realtime.subscribe(SYMBOL, TIMEFRAME);
    const offCandle = realtime.on('candle', (payload) => {
      if (payload.symbol !== SYMBOL || payload.timeframe !== TIMEFRAME) return;
      setCandles((current) => {
        if (!current) return current;
        const last = current[current.length - 1];
        const next = last && last.time === payload.candle.time ? current.slice(0, -1) : current.slice(1);
        return [...next, payload.candle];
      });
    });

    return () => {
      mounted.current = false;
      unsubscribe();
      offCandle();
    };
  }, []);

  if (!candles || candles.length < 2) {
    return <div aria-hidden className={`skeleton ${className}`} />;
  }

  const closes = candles.map((c) => c.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const span = max - min || 1;
  const width = 400;
  const height = 120;
  const step = width / (closes.length - 1);
  const points = closes.map((c, i) => `${i * step},${height - ((c - min) / span) * (height - 12) - 6}`);
  const rising = closes[closes.length - 1] >= closes[0];
  const lastX = (closes.length - 1) * step;
  const lastY = height - ((closes[closes.length - 1] - min) / span) * (height - 12) - 6;
  const reducedMotion =
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`Live ${SYMBOL} chart`}
      className={className}
    >
      <polyline
        points={points.join(' ')}
        fill="none"
        stroke={rising ? '#12b886' : '#f0455e'}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <polygon
        points={`0,${height} ${points.join(' ')} ${width},${height}`}
        fill={rising ? '#12b886' : '#f0455e'}
        fillOpacity={0.08}
      />
      <circle cx={lastX} cy={lastY} r={3.5} fill={rising ? '#12b886' : '#f0455e'}>
        {!reducedMotion && (
          <>
            <animate attributeName="r" values="3.5;6;3.5" dur="1.6s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="1;0.4;1" dur="1.6s" repeatCount="indefinite" />
          </>
        )}
      </circle>
    </svg>
  );
}
