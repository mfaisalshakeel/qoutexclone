import { useEffect, useRef } from 'react';
import {
  ColorType,
  CrosshairMode,
  LineStyle,
  createChart,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import { api } from '../lib/api';
import { realtime } from '../lib/ws';
import type { Candle, Trade } from '../lib/types';

interface Props {
  symbol: string;
  timeframe: string;
  precision: number;
  trades: Trade[];
}

const THEME = {
  background: '#0f1421',
  grid: '#1c2436',
  text: '#7c8aa5',
  up: '#12b886',
  down: '#f0455e',
};

/**
 * Candlestick terminal chart. History arrives over REST, live updates over the
 * socket, and every open position is drawn as a strike line plus an expiry
 * marker so the trader can see exactly what has to happen to win.
 */
export function PriceChart({ symbol, timeframe, precision, trades }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const linesRef = useRef<IPriceLine[]>([]);

  // chart instance — created once
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      layout: {
        background: { type: ColorType.Solid, color: THEME.background },
        textColor: THEME.text,
        fontFamily: 'Inter, system-ui, sans-serif',
      },
      grid: {
        vertLines: { color: THEME.grid },
        horzLines: { color: THEME.grid },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: '#3a4763', labelBackgroundColor: '#273149' },
        horzLine: { color: '#3a4763', labelBackgroundColor: '#273149' },
      },
      rightPriceScale: { borderColor: THEME.grid, scaleMargins: { top: 0.12, bottom: 0.12 } },
      timeScale: { borderColor: THEME.grid, timeVisible: true, secondsVisible: true, rightOffset: 6 },
      handleScale: { axisPressedMouseMove: { time: true, price: false } },
      autoSize: true,
    });

    const series = chart.addCandlestickSeries({
      upColor: THEME.up,
      downColor: THEME.down,
      borderUpColor: THEME.up,
      borderDownColor: THEME.down,
      wickUpColor: THEME.up,
      wickDownColor: THEME.down,
      priceFormat: { type: 'price', precision, minMove: 1 / 10 ** precision },
    });

    chartRef.current = chart;
    seriesRef.current = series;

    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      linesRef.current = [];
    };
    // precision belongs to the symbol; the reload effect below re-applies it
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // history + live updates for the selected market
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    let cancelled = false;

    series.applyOptions({ priceFormat: { type: 'price', precision, minMove: 1 / 10 ** precision } });

    const toBar = (candle: Candle) => ({
      time: candle.time as UTCTimestamp,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
    });

    api
      .get<{ candles: Candle[] }>(`/market/candles/${symbol}?timeframe=${timeframe}&limit=300`)
      .then(({ candles }) => {
        if (cancelled || !seriesRef.current) return;
        seriesRef.current.setData(candles.map(toBar));
        chartRef.current?.timeScale().scrollToRealTime();
      })
      .catch(() => undefined);

    realtime.subscribe(symbol, timeframe);

    const offSnapshot = realtime.on('candles', (payload) => {
      if (cancelled || payload.symbol !== symbol || payload.timeframe !== timeframe) return;
      seriesRef.current?.setData(payload.candles.map(toBar));
    });
    const offCandle = realtime.on('candle', (payload) => {
      if (cancelled || payload.symbol !== symbol || payload.timeframe !== timeframe) return;
      seriesRef.current?.update(toBar(payload.candle));
    });

    return () => {
      cancelled = true;
      offSnapshot();
      offCandle();
    };
  }, [symbol, timeframe, precision]);

  // strike lines and expiry markers for the open positions on this market
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;

    for (const line of linesRef.current) series.removePriceLine(line);
    linesRef.current = [];

    const mine = trades.filter((trade) => trade.symbol === symbol && trade.status === 'OPEN');
    for (const trade of mine) {
      linesRef.current.push(
        series.createPriceLine({
          price: trade.entryPrice,
          color: trade.direction === 'UP' ? THEME.up : THEME.down,
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: `${trade.direction === 'UP' ? '▲' : '▼'} $${(trade.stake / 100).toFixed(0)}`,
        }),
      );
    }

    series.setMarkers(
      mine.map((trade) => ({
        time: (Math.floor(new Date(trade.openedAt).getTime() / 1000) as UTCTimestamp),
        position: trade.direction === 'UP' ? ('belowBar' as const) : ('aboveBar' as const),
        color: trade.direction === 'UP' ? THEME.up : THEME.down,
        shape: trade.direction === 'UP' ? ('arrowUp' as const) : ('arrowDown' as const),
        text: `${trade.direction} $${(trade.stake / 100).toFixed(0)}`,
      })),
    );
  }, [trades, symbol]);

  return <div ref={containerRef} className="h-full w-full" />;
}
