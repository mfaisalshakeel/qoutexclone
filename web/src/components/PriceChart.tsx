import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { realtime } from '../lib/ws';
import { useMarket } from '../store/market';
import { ChartEngine } from '../chart/engine';
import { buildStudy, type StudySettings } from '../chart/studies';
import { sanitise, type Drawing, type DrawingKind } from '../chart/drawings';
import { DrawingTools } from './DrawingTools';
import type { SeriesKind } from '../chart/series';
import { THEME } from '../chart/types';
import type { Candle, Trade } from '../lib/types';
import { ChartSkeleton } from './Skeleton';

export type ChartType = SeriesKind;

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
  /** The studies the trader has on the chart, already configured. */
  studies: StudySettings[];
  /** The marks this market carries, and a way to save them when they change. */
  drawings?: unknown;
  onDrawingsChange?: (symbol: string, drawings: Drawing[]) => void;
}

/**
 * The terminal chart, drawn by this project's own canvas engine.
 *
 * History arrives over REST and live candles over the socket; the component
 * owns the data and the engine owns the pixels. Every open position is drawn as
 * a strike line so a trader can see exactly what has to happen to win.
 */
export function PriceChart({
  symbol,
  timeframe,
  precision,
  trades,
  chartType,
  studies,
  drawings: storedDrawings,
  onDrawingsChange,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<ChartEngine | null>(null);
  const [loading, setLoading] = useState(true);
  const [live, setLive] = useState(true);
  const [autoScaled, setAutoScaled] = useState(true);
  const [tool, setTool] = useState<DrawingKind | null>(null);
  const [selected, setSelected] = useState<Drawing | null>(null);
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [color, setColor] = useState('#f6c445');
  const cutoffSec = useMarket((s) => s.expiry.clock.cutoffSec);

  const dataRef = useRef<Candle[]>([]);
  /** Paging cursor for older history; null when the market has no more. */
  const beforeRef = useRef<number | null>(null);
  const loadingOlderRef = useRef(false);
  const loadOlderRef = useRef<() => void>(() => {});
  const saveDrawingsRef = useRef<(marks: Drawing[]) => void>(() => {});
  saveDrawingsRef.current = (marks: Drawing[]) => onDrawingsChange?.(symbol, marks);
  const studiesRef = useRef(studies);
  studiesRef.current = studies;

  // the engine outlives the data: it is created once and fed
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const engine = new ChartEngine(container, {
      precision,
      onView: ({ oldestVisible, atLive }) => {
        setLive(atLive);
        setAutoScaled(engineRef.current?.isAutoScaled ?? true);
        // a few bars of margin, so the next page is there before it is needed
        if (oldestVisible < 10) loadOlderRef.current();
      },
      onDrawings: (marks) => {
        setDrawings(marks);
        saveDrawingsRef.current(marks);
      },
      onSelect: setSelected,
      onTool: setTool,
    });
    engineRef.current = engine;
    return () => {
      engine.destroy();
      engineRef.current = null;
    };
    // precision rides with the symbol; the reload effect re-applies it
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Rebuilds every study from the candles currently held. */
  const paintOverlays = () => {
    const candles = dataRef.current;
    const built = studiesRef.current
      .map((study) => buildStudy(candles, study))
      .filter((study): study is NonNullable<typeof study> => study !== null);
    engineRef.current?.setStudies(built);
  };

  // history + live updates for the selected market
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    let cancelled = false;
    setLoading(true);
    engine.setPrecision(precision);

    api
      .get<HistoryPage>(`/market/candles/${symbol}?timeframe=${timeframe}&limit=300`)
      .then(({ candles, nextBefore }) => {
        if (cancelled) return;
        beforeRef.current = nextBefore ?? candles[0]?.time ?? null;
        dataRef.current = candles;
        engine.setCandles(candles);
        paintOverlays();
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });

    /**
     * Infinite scroll into the past: reaching the oldest loaded bar fetches the
     * previous page and prepends it. `nextBefore` is null once the market has
     * no more history, which stops the paging for good.
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
        engine.prepend(page.candles);
        paintOverlays();
      } catch {
        /* keep the cursor so the next scroll retries */
      } finally {
        loadingOlderRef.current = false;
      }
    };
    loadOlderRef.current = () => void loadOlder();

    const unsubscribe = realtime.subscribe(symbol, timeframe);
    const offSnapshot = realtime.on('candles', (payload) => {
      if (cancelled || payload.symbol !== symbol || payload.timeframe !== timeframe) return;
      dataRef.current = payload.candles;
      engine.setCandles(payload.candles, { keepView: true });
      paintOverlays();
      setLoading(false);
    });
    const offCandle = realtime.on('candle', (payload) => {
      if (cancelled || payload.symbol !== symbol || payload.timeframe !== timeframe) return;
      const candles = dataRef.current;
      const last = candles[candles.length - 1];
      if (last && last.time === payload.candle.time) candles[candles.length - 1] = payload.candle;
      else candles.push(payload.candle);
      engine.update(payload.candle);
      paintOverlays();
    });

    return () => {
      cancelled = true;
      loadOlderRef.current = () => {};
      unsubscribe();
      offSnapshot();
      offCandle();
    };
  }, [symbol, timeframe, precision]);

  useEffect(() => {
    engineRef.current?.setType(chartType);
  }, [chartType]);

  useEffect(() => {
    engineRef.current?.setCutoff(cutoffSec);
  }, [cutoffSec]);

  /**
   * Marks belong to a market: switching markets swaps them, rather than
   * carrying yesterday's trend line onto another chart.
   *
   * Keyed on the market alone. The stored set is the source of truth when a
   * chart opens; after that the engine owns them, and re-applying the prop as
   * it echoes back through the account would undo the selection the trader is
   * working with.
   */
  const storedRef = useRef(storedDrawings);
  storedRef.current = storedDrawings;
  useEffect(() => {
    const marks = sanitise(storedRef.current);
    setDrawings(marks);
    setSelected(null);
    setTool(null);
    engineRef.current?.setDrawings(marks);
    engineRef.current?.setTool(null);
  }, [symbol]);

  useEffect(() => {
    engineRef.current?.setTool(tool);
  }, [tool]);

  useEffect(() => {
    if (engineRef.current) engineRef.current.drawColor = color;
  }, [color]);

  // a selected mark is deleted with the keyboard, as in every other package
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setTool(null);
        engineRef.current?.select(null);
        return;
      }
      if (event.key !== 'Delete' && event.key !== 'Backspace') return;
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      const current = engineRef.current?.selected;
      if (current && !current.locked) engineRef.current?.removeDrawing(current.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    // the studies are rebuilt whenever their configuration changes
    paintOverlays();
  }, [studies]);

  useEffect(() => {
    engineRef.current?.setTrades(trades.filter((trade) => trade.symbol === symbol));
  }, [trades, symbol]);

  const zoom = (factor: number) => {
    engineRef.current?.zoom(factor);
    setAutoScaled(engineRef.current?.isAutoScaled ?? true);
  };

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      {loading && <ChartSkeleton />}

      <DrawingTools
        tool={tool}
        onTool={setTool}
        color={selected?.color ?? color}
        onColor={setColor}
        selected={selected}
        onUpdate={(patch) => selected && engineRef.current?.updateDrawing(selected.id, patch)}
        onDelete={() => selected && engineRef.current?.removeDrawing(selected.id)}
        onClear={() => engineRef.current?.clearDrawings()}
        count={drawings.length}
      />

      {/* the controls a mouse has on the wheel, for a finger and a keyboard */}
      <div className="absolute bottom-7 left-2 z-10 flex gap-1">
        <button
          onClick={() => zoom(0.8)}
          aria-label="Zoom in"
          className="h-7 w-7 rounded-lg border border-ink-500 bg-ink-800/90 text-sm font-semibold text-slate-300 transition hover:bg-ink-700"
        >
          +
        </button>
        <button
          onClick={() => zoom(1.25)}
          aria-label="Zoom out"
          className="h-7 w-7 rounded-lg border border-ink-500 bg-ink-800/90 text-sm font-semibold text-slate-300 transition hover:bg-ink-700"
        >
          −
        </button>
        {!autoScaled && (
          <button
            onClick={() => {
              engineRef.current?.autoScale();
              setAutoScaled(true);
            }}
            aria-label="Autoscale the price"
            className="h-7 rounded-lg border border-ink-500 bg-ink-800/90 px-2 text-[11px] font-semibold text-slate-300 transition hover:bg-ink-700"
          >
            Auto
          </button>
        )}
      </div>

      {!live && !loading && (
        <button
          onClick={() => engineRef.current?.scrollToLive()}
          className="absolute bottom-7 right-[70px] z-10 rounded-full border border-ink-500 bg-ink-800/90 px-3 py-1.5 text-[11px] font-semibold text-slate-200 shadow-lg transition hover:bg-ink-700"
        >
          Scroll to live ›
        </button>
      )}
    </div>
  );
}

export { THEME as CHART_THEME };
