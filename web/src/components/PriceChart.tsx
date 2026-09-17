import { useEffect, useRef, useState } from 'react';
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
import { bollinger, ema, sma } from '../lib/indicators';
import type { Candle, Trade } from '../lib/types';
import { ChartSkeleton } from './Skeleton';

export type ChartType = 'candles' | 'line';

export interface IndicatorSettings {
  sma: boolean;
  ema: boolean;
  bollinger: boolean;
}

interface HistoryPage {
  candles: Candle[];
  /** Cursor for the next page of older candles; null when exhausted. */
  nextBefore: number | null;
}

interface Props {
  symbol: string;
  timeframe: string;
  precision: number;
  trades: Trade[];
  chartType: ChartType;
  indicators: IndicatorSettings;
}

const THEME = {
  background: '#0f1421',
  grid: '#1c2436',
  text: '#7c8aa5',
  up: '#12b886',
  down: '#f0455e',
  sma: '#f6c445',
  ema: '#3d7bff',
  band: '#7c8aa5',
};

const SMA_PERIOD = 20;
const EMA_PERIOD = 50;

/**
 * Candlestick terminal chart. History arrives over REST, live updates over the
 * socket, and every open position is drawn as a strike line plus an entry
 * marker so the trader can see exactly what has to happen to win.
 */
export function PriceChart({ symbol, timeframe, precision, trades, chartType, indicators }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const areaRef = useRef<ISeriesApi<'Area'> | null>(null);
  const smaRef = useRef<ISeriesApi<'Line'> | null>(null);
  const emaRef = useRef<ISeriesApi<'Line'> | null>(null);
  const bandRefs = useRef<ISeriesApi<'Line'>[]>([]);
  const linesRef = useRef<IPriceLine[]>([]);
  const dataRef = useRef<Candle[]>([]);
  /** Paging cursor for older history; null when the market has no more. */
  const beforeRef = useRef<number | null>(null);
  const loadingOlderRef = useRef(false);
  // live candle updates fire from a long-lived subscription, so the overlay
  // painter reads the current settings from a ref rather than a stale closure
  const settingsRef = useRef(indicators);
  settingsRef.current = indicators;

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
      grid: { vertLines: { color: THEME.grid }, horzLines: { color: THEME.grid } },
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

    const priceFormat = { type: 'price' as const, precision, minMove: 1 / 10 ** precision };
    candleRef.current = chart.addCandlestickSeries({
      upColor: THEME.up,
      downColor: THEME.down,
      borderUpColor: THEME.up,
      borderDownColor: THEME.down,
      wickUpColor: THEME.up,
      wickDownColor: THEME.down,
      priceFormat,
    });
    areaRef.current = chart.addAreaSeries({
      lineColor: THEME.ema,
      topColor: 'rgba(61,123,255,0.28)',
      bottomColor: 'rgba(61,123,255,0.02)',
      lineWidth: 2,
      priceFormat,
      visible: false,
    });
    smaRef.current = chart.addLineSeries({
      color: THEME.sma,
      lineWidth: 1,
      priceLineVisible: false,
      visible: false,
    });
    emaRef.current = chart.addLineSeries({
      color: THEME.ema,
      lineWidth: 1,
      priceLineVisible: false,
      visible: false,
    });
    bandRefs.current = [0, 1].map(() =>
      chart.addLineSeries({
        color: THEME.band,
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        priceLineVisible: false,
        lastValueVisible: false,
        visible: false,
      }),
    );

    chartRef.current = chart;
    return () => {
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      areaRef.current = null;
      smaRef.current = null;
      emaRef.current = null;
      bandRefs.current = [];
      linesRef.current = [];
    };
    // precision rides with the symbol; the reload effect re-applies it
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Recomputes every overlay from the candles currently held. */
  const paintOverlays = () => {
    const candles = dataRef.current;
    const active = settingsRef.current;
    const toLine = (points: { time: number; value: number }[]) =>
      points.map((p) => ({ time: p.time as UTCTimestamp, value: p.value }));

    smaRef.current?.setData(active.sma ? toLine(sma(candles, SMA_PERIOD)) : []);
    emaRef.current?.setData(active.ema ? toLine(ema(candles, EMA_PERIOD)) : []);
    if (active.bollinger) {
      const bands = bollinger(candles);
      bandRefs.current[0]?.setData(toLine(bands.upper));
      bandRefs.current[1]?.setData(toLine(bands.lower));
    } else {
      for (const band of bandRefs.current) band.setData([]);
    }
  };

  // history + live updates for the selected market
  useEffect(() => {
    if (!candleRef.current) return;
    let cancelled = false;
    setLoading(true);

    const priceFormat = { type: 'price' as const, precision, minMove: 1 / 10 ** precision };
    candleRef.current.applyOptions({ priceFormat });
    areaRef.current?.applyOptions({ priceFormat });

    function toBar(candle: Candle) {
      return {
        time: candle.time as UTCTimestamp,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      };
    }

    const setAll = (candles: Candle[]) => {
      dataRef.current = candles;
      candleRef.current?.setData(candles.map(toBar));
      areaRef.current?.setData(candles.map((c) => ({ time: c.time as UTCTimestamp, value: c.close })));
      paintOverlays();
    };

    api
      .get<HistoryPage>(`/market/candles/${symbol}?timeframe=${timeframe}&limit=300`)
      .then(({ candles, nextBefore }) => {
        if (cancelled) return;
        beforeRef.current = nextBefore ?? candles[0]?.time ?? null;
        setAll(candles);
        setLoading(false);
        chartRef.current?.timeScale().scrollToRealTime();
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });

    /**
     * Infinite scroll into the past: when the view reaches the oldest loaded
     * bar, fetch the previous page and prepend it. `nextBefore` is null once
     * the market has no more history, which stops the paging for good.
     */
    const loadOlder = async () => {
      if (loadingOlderRef.current || cancelled || beforeRef.current === null) return;
      loadingOlderRef.current = true;
      try {
        const page = await api.get<HistoryPage>(
          `/market/candles/${symbol}?timeframe=${timeframe}&limit=300&before=${beforeRef.current}`,
        );
        if (cancelled) return;
        if (page.candles.length === 0) {
          beforeRef.current = null;
          return;
        }
        beforeRef.current = page.nextBefore;
        dataRef.current = [...page.candles, ...dataRef.current];
        candleRef.current?.setData(dataRef.current.map(toBar));
        areaRef.current?.setData(
          dataRef.current.map((candle) => ({ time: candle.time as UTCTimestamp, value: candle.close })),
        );
        paintOverlays();
      } catch {
        /* keep the cursor so the next scroll retries */
      } finally {
        loadingOlderRef.current = false;
      }
    };

    const onRangeChange = (range: { from: number; to: number } | null) => {
      if (!range) return;
      // logical 0 is the oldest loaded bar, so a small margin pre-fetches
      if (range.from < 10) void loadOlder();
    };
    chartRef.current?.timeScale().subscribeVisibleLogicalRangeChange(onRangeChange);

    realtime.subscribe(symbol, timeframe);

    const offSnapshot = realtime.on('candles', (payload) => {
      if (cancelled || payload.symbol !== symbol || payload.timeframe !== timeframe) return;
      setAll(payload.candles);
      setLoading(false);
    });
    const offCandle = realtime.on('candle', (payload) => {
      if (cancelled || payload.symbol !== symbol || payload.timeframe !== timeframe) return;
      const candles = dataRef.current;
      const last = candles[candles.length - 1];
      if (last && last.time === payload.candle.time) candles[candles.length - 1] = payload.candle;
      else candles.push(payload.candle);
      candleRef.current?.update(toBar(payload.candle));
      areaRef.current?.update({ time: payload.candle.time as UTCTimestamp, value: payload.candle.close });
      paintOverlays();
    });

    return () => {
      cancelled = true;
      chartRef.current?.timeScale().unsubscribeVisibleLogicalRangeChange(onRangeChange);
      offSnapshot();
      offCandle();
    };
  }, [symbol, timeframe, precision]);

  // chart type and indicator toggles
  useEffect(() => {
    candleRef.current?.applyOptions({ visible: chartType === 'candles' });
    areaRef.current?.applyOptions({ visible: chartType === 'line' });
    smaRef.current?.applyOptions({ visible: indicators.sma });
    emaRef.current?.applyOptions({ visible: indicators.ema });
    for (const band of bandRefs.current) band.applyOptions({ visible: indicators.bollinger });
    paintOverlays();
  }, [chartType, indicators.sma, indicators.ema, indicators.bollinger]);

  // strike lines and entry markers for open positions on this market
  useEffect(() => {
    const series = candleRef.current;
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

    // the library asserts markers are in ascending time order; open trades arrive newest first
    series.setMarkers(
      [...mine]
        .sort((a, b) => new Date(a.openedAt).getTime() - new Date(b.openedAt).getTime())
        .map((trade) => ({
          time: Math.floor(new Date(trade.openedAt).getTime() / 1000) as UTCTimestamp,
          position: trade.direction === 'UP' ? ('belowBar' as const) : ('aboveBar' as const),
          color: trade.direction === 'UP' ? THEME.up : THEME.down,
          shape: trade.direction === 'UP' ? ('arrowUp' as const) : ('arrowDown' as const),
          text: `${trade.direction} $${(trade.stake / 100).toFixed(0)}`,
        })),
    );
  }, [trades, symbol]);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      {loading && <ChartSkeleton />}
    </div>
  );
}
