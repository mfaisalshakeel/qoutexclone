import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, api } from '../lib/api';
import { realtime } from '../lib/ws';
import { percent, price, untilShort } from '../lib/format';
import { assetOf, useMarket } from '../store/market';
import { useAuth } from '../store/auth';
import { useTradingAccount } from '../store/tradingAccount';
import { toast } from '../store/toast';
import { DESKTOP_QUERY, useMediaQuery } from '../hooks/useMediaQuery';
import { AssetPicker } from '../components/AssetPicker';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { PriceChart, type ChartType, type IndicatorSettings } from '../components/PriceChart';
import { Positions } from '../components/Positions';
import { TradeTicket, type TicketHandle } from '../components/TradeTicket';
import { HotkeyHelp } from '../components/HotkeyHelp';
import { useHotkeys } from '../hooks/useHotkeys';
import { ChartSkeleton, Skeleton, SkeletonGroup } from '../components/Skeleton';
import type { PendingOrder, Trade } from '../lib/types';

/** Traders should always know where a quote comes from. */
function sourceLabel(source: string): { text: string; title: string } {
  if (source === 'broker') {
    return { text: 'broker price', title: 'Priced by Quantex, not an exchange feed' };
  }
  return { text: `live · ${source}`, title: `Live market data from ${source}` };
}

/** Shown inline; the rest live behind the "···" menu. */
const QUICK_TIMEFRAMES = ['5s', '15s', '1m', '5m', '1h'];

const STUDIES = [
  { key: 'sma' as const, label: 'SMA 20', color: '#f6c445' },
  { key: 'ema' as const, label: 'EMA 50', color: '#3d7bff' },
  { key: 'bollinger' as const, label: 'Bollinger bands', color: '#7c8aa5' },
];

export function Terminal() {
  const { assets, prices, symbol, timeframe, timeframes, setTimeframe, load, loaded } = useMarket();
  const selectSymbol = useMarket((s) => s.selectSymbol);
  const ticketConfig = useMarket((s) => s.ticket);
  const user = useAuth((s) => s.user);
  const [openTrades, setOpenTrades] = useState<Trade[]>([]);
  const [closedTrades, setClosedTrades] = useState<Trade[]>([]);
  const [orders, setOrders] = useState<PendingOrder[]>([]);
  const [tradesLoaded, setTradesLoaded] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<'trade' | 'positions'>('trade');
  const [marketsOpen, setMarketsOpen] = useState(false);
  const [chartType, setChartType] = useState<ChartType>('candles');
  const [indicators, setIndicators] = useState<IndicatorSettings>({
    sma: false,
    ema: false,
    bollinger: false,
  });
  const [studiesOpen, setStudiesOpen] = useState(false);
  const [timeframesOpen, setTimeframesOpen] = useState(false);
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const ticketRef = useRef<TicketHandle>(null);
  const [helpOpen, setHelpOpen] = useState(false);

  const asset = useMemo(() => assetOf(symbol, assets), [symbol, assets]);
  const livePrice = prices[symbol] ?? asset?.price ?? null;
  const tournamentId = useTradingAccount((s) => s.tournamentId);
  const setTournamentBalance = useTradingAccount((s) => s.setBalance);
  const patchBalance = useAuth((s) => s.patchBalance);
  const accountType = tournamentId ? 'TOURNAMENT' : (user?.activeAccount ?? 'DEMO');

  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  const loadTrades = useCallback(async () => {
    setTradesLoaded(false);
    const [open, closed, pending] = await Promise.all([
      api.get<{ trades: Trade[] }>(`/trades?status=OPEN&accountType=${accountType}`),
      api.get<{ trades: Trade[] }>(`/trades?status=CLOSED&accountType=${accountType}&limit=30`),
      api.get<{ orders: PendingOrder[] }>('/trades/pending?limit=50'),
    ]);
    setOpenTrades(open.trades);
    setClosedTrades(closed.trades);
    setOrders(pending.orders);
    setTradesLoaded(true);
  }, [accountType]);

  /** Replaces one order in place, whatever its new state. */
  const patchOrder = useCallback((order: PendingOrder) => {
    setOrders((current) => {
      const without = current.filter((row) => row.id !== order.id);
      return [order, ...without];
    });
  }, []);

  const repeatTrade = useCallback(
    async (tradeId: string, multiplier: 1 | 2) => {
      try {
        const data = await api.post<{
          trade: Trade;
          balances: { demoBalance: number; realBalance: number };
          tournamentBalance: number | null;
        }>(`/trades/${tradeId}/repeat`, { multiplier });
        setOpenTrades((current) => [data.trade, ...current]);
        if (data.tournamentBalance != null) setTournamentBalance(data.tournamentBalance);
        else
          patchBalance(
            data.trade.accountType,
            data.trade.accountType === 'DEMO' ? data.balances.demoBalance : data.balances.realBalance,
          );
        toast.info(
          multiplier === 2 ? 'Doubled up' : 'Repeated',
          `${data.trade.symbol} ${data.trade.direction} · ${data.trade.entryPrice}`,
        );
      } catch (err) {
        toast.error('Could not repeat', err instanceof ApiError ? err.message : 'Please try again');
      }
    },
    [patchBalance, setTournamentBalance],
  );

  const cancelOrder = useCallback(
    async (orderId: string) => {
      try {
        const { order } = await api.del<{ order: PendingOrder }>(`/trades/pending/${orderId}`);
        patchOrder(order);
        toast.info('Order cancelled');
      } catch (err) {
        toast.error('Could not cancel', err instanceof ApiError ? err.message : 'Please try again');
      }
    },
    [patchOrder],
  );

  useEffect(() => {
    void loadTrades();
  }, [loadTrades]);

  // settled positions move from the open list to the closed list in place
  useEffect(() => {
    return realtime.on('trade:settled', ({ trade }) => {
      setOpenTrades((current) => current.filter((t) => t.id !== trade.id));
      if (trade.accountType === accountType) setClosedTrades((current) => [trade, ...current].slice(0, 30));
    });
  }, [accountType]);

  // an order changes state on its own — a level is reached, a window closes —
  // so every transition arrives over the socket
  useEffect(() => {
    const offUpdated = realtime.on('order:updated', ({ order }) => patchOrder(order));
    const offFailed = realtime.on('order:failed', ({ order }) => {
      patchOrder(order);
      toast.error('Order could not be opened', order.failureReason ?? undefined);
    });
    const offFilled = realtime.on('order:filled', ({ order, trade }) => {
      patchOrder(order);
      if (trade.accountType === accountType) setOpenTrades((current) => [trade, ...current]);
      toast.success('Pending order filled', `${trade.symbol} ${trade.direction} at ${trade.entryPrice}`);
    });
    return () => {
      offUpdated();
      offFailed();
      offFilled();
    };
  }, [accountType, patchOrder]);

  /** Walks the market list, skipping nothing: a closed market is still selectable. */
  const stepAsset = useCallback(
    (delta: number) => {
      if (assets.length === 0) return;
      const at = assets.findIndex((each) => each.symbol === symbol);
      const next = ((((at < 0 ? 0 : at) + delta) % assets.length) + assets.length) % assets.length;
      selectSymbol(assets[next].symbol);
    },
    [assets, symbol, selectSymbol],
  );

  const hotkeyHandlers = useMemo(
    () => ({
      higher: () => ticketRef.current?.higher(),
      lower: () => ticketRef.current?.lower(),
      amountUp: () => ticketRef.current?.amountUp(),
      amountDown: () => ticketRef.current?.amountDown(),
      expiryUp: () => ticketRef.current?.expiryUp(),
      expiryDown: () => ticketRef.current?.expiryDown(),
      nextAsset: () => stepAsset(1),
      prevAsset: () => stepAsset(-1),
      help: () => setHelpOpen((open) => !open),
    }),
    [stepAsset],
  );

  const hotkeys = useHotkeys(hotkeyHandlers, ticketConfig.hotkeys);

  const changePct = asset?.changePct ?? 0;
  const activeStudies = Object.values(indicators).filter(Boolean).length;

  // Escape closes the market sheet and the studies menu
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setMarketsOpen(false);
      setStudiesOpen(false);
      setTimeframesOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="flex flex-col gap-2 p-2 md:h-[calc(100dvh-3.5rem)] md:flex-row">
      {helpOpen && <HotkeyHelp state={hotkeys} onClose={() => setHelpOpen(false)} />}
      {/* markets — rail on desktop, sheet on mobile */}
      {isDesktop && (
        <aside className="card w-60 shrink-0">
          <AssetPicker />
        </aside>
      )}

      <section className="flex min-h-0 flex-1 flex-col gap-2">
        <header className="card flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 p-2.5">
          {!asset ? (
            <SkeletonGroup label="Loading market" className="flex items-center gap-3">
              <Skeleton className="h-9 w-9 !rounded-full" />
              <div className="space-y-1.5">
                <Skeleton className="h-3.5 w-24" />
                <Skeleton className="h-2.5 w-28" />
              </div>
              <div className="ml-2 space-y-1.5">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-2.5 w-12" />
              </div>
            </SkeletonGroup>
          ) : (
            <>
              <button
                onClick={() => setMarketsOpen(true)}
                className="flex items-center gap-2 rounded-lg px-1 py-0.5 text-left md:pointer-events-none"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-ink-600 text-[10px] font-bold text-slate-300">
                  {asset?.icon ?? asset?.base ?? '—'}
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 text-sm font-bold">
                    <span className="truncate">{asset?.name.replace(' (OTC)', '') ?? symbol}</span>
                    {asset?.isOtc && <span className="chip bg-accent-soft text-accent">OTC</span>}
                  </span>
                  <span className="block truncate text-[10px] text-slate-500">
                    {asset?.pair.replace(' (OTC)', '') ?? symbol} · payout {asset?.payoutPct ?? 0}%
                    {asset && (
                      <span title={sourceLabel(asset.priceSource).title}>
                        {' · '}
                        {sourceLabel(asset.priceSource).text}
                      </span>
                    )}
                  </span>
                </span>
                <svg viewBox="0 0 20 20" className="h-4 w-4 text-slate-500 md:hidden" fill="currentColor">
                  <path d="M5.5 8l4.5 4.5L14.5 8z" />
                </svg>
              </button>

              <div className="ml-1">
                <span className="tabular block text-lg font-bold leading-tight">
                  {price(livePrice, asset?.precision ?? 2)}
                </span>
                {asset && !asset.isOpen ? (
                  <span className="block text-[11px] text-slate-400">
                    Closed{asset.nextOpen ? ` · opens ${untilShort(asset.nextOpen)}` : ''}
                  </span>
                ) : (
                  <span className={`tabular block text-[11px] ${changePct >= 0 ? 'text-up' : 'text-down'}`}>
                    {percent(changePct)}
                  </span>
                )}
              </div>
            </>
          )}

          {/* the toolbar scrolls inside its own box rather than widening the page */}
          <div className="-mx-1 flex w-full min-w-0 items-center gap-1 overflow-x-auto px-1 md:ml-auto md:w-auto md:overflow-visible">
            {/* quick picks inline, the full set behind a menu: 14 timeframes
                will not fit a toolbar at any width */}
            <div className="flex gap-1">
              {QUICK_TIMEFRAMES.filter((tf) => timeframes.includes(tf)).map((tf) => (
                <button
                  key={tf}
                  onClick={() => setTimeframe(tf)}
                  aria-pressed={timeframe === tf}
                  className={`rounded-md px-2.5 py-1.5 text-xs font-semibold transition ${
                    timeframe === tf ? 'bg-ink-600 text-white' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {tf}
                </button>
              ))}

              <div className="relative">
                <button
                  onClick={() => setTimeframesOpen((open) => !open)}
                  className={`rounded-md px-2.5 py-1.5 text-xs font-semibold transition ${
                    QUICK_TIMEFRAMES.includes(timeframe)
                      ? 'text-slate-400 hover:text-slate-200'
                      : 'bg-ink-600 text-white'
                  }`}
                  aria-label="All timeframes"
                >
                  {QUICK_TIMEFRAMES.includes(timeframe) ? '···' : timeframe}
                </button>
                {timeframesOpen && (
                  <div className="absolute right-0 z-30 mt-2 grid w-44 grid-cols-3 gap-1 rounded-xl border border-ink-500 bg-ink-800 p-1.5 shadow-2xl">
                    {timeframes.map((tf) => (
                      <button
                        key={tf}
                        onClick={() => {
                          setTimeframe(tf);
                          setTimeframesOpen(false);
                        }}
                        aria-pressed={timeframe === tf}
                        className={`rounded-md px-2 py-1.5 text-xs font-semibold transition ${
                          timeframe === tf ? 'bg-accent text-white' : 'text-slate-300 hover:bg-ink-700'
                        }`}
                      >
                        {tf}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="mx-1 hidden h-5 w-px bg-ink-600 sm:block" />

            <div className="flex gap-1">
              {(['candles', 'line'] as const).map((type) => (
                <button
                  key={type}
                  onClick={() => setChartType(type)}
                  title={type === 'candles' ? 'Candlesticks' : 'Line'}
                  className={`rounded-md px-2 py-1.5 text-xs font-semibold capitalize transition ${
                    chartType === type ? 'bg-ink-600 text-white' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {type === 'candles' ? '▦' : '〰'}
                </button>
              ))}
            </div>

            <div className="relative">
              <button
                onClick={() => setStudiesOpen((v) => !v)}
                className={`rounded-md px-2.5 py-1.5 text-xs font-semibold transition ${
                  activeStudies > 0 ? 'bg-accent-soft text-accent' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Studies{activeStudies > 0 ? ` (${activeStudies})` : ''}
              </button>
              {studiesOpen && (
                <div className="absolute right-0 z-30 mt-2 w-56 animate-fade-up rounded-xl border border-ink-500 bg-ink-800 p-1.5 shadow-2xl">
                  {STUDIES.map((study) => (
                    <label
                      key={study.key}
                      className="flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-xs transition hover:bg-ink-700"
                    >
                      <input
                        type="checkbox"
                        checked={indicators[study.key]}
                        onChange={(e) => setIndicators((c) => ({ ...c, [study.key]: e.target.checked }))}
                        className="h-3.5 w-3.5 accent-[#3d7bff]"
                      />
                      <span className="flex-1 text-slate-200">{study.label}</span>
                      <span className="h-1 w-5 rounded-full" style={{ background: study.color }} />
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>
        </header>

        <div className="card relative h-[42dvh] min-h-[240px] overflow-hidden md:h-auto md:flex-1">
          {!asset && <ChartSkeleton />}
          {asset && (
            <ErrorBoundary variant="inline" title="Chart unavailable" resetKey={`${symbol}:${timeframe}`}>
              <PriceChart
                symbol={symbol}
                timeframe={timeframe}
                precision={asset.precision}
                trades={openTrades}
                chartType={chartType}
                indicators={indicators}
              />
            </ErrorBoundary>
          )}
        </div>

        {/* narrow viewports swap between the ticket and the positions list */}
        {!isDesktop && (
          <>
            <div className="grid shrink-0 grid-cols-2 gap-1">
              {(['trade', 'positions'] as const).map((panel) => (
                <button
                  key={panel}
                  onClick={() => setMobilePanel(panel)}
                  className={`rounded-lg py-2 text-xs font-semibold capitalize transition ${
                    mobilePanel === panel ? 'bg-ink-600 text-white' : 'bg-ink-800 text-slate-400'
                  }`}
                >
                  {panel === 'trade' ? 'Trade' : `Positions (${openTrades.length})`}
                </button>
              ))}
            </div>
            <div>
              {mobilePanel === 'trade' ? (
                <TradeTicket
                  asset={asset}
                  onPlaced={(trade) => setOpenTrades((c) => [trade, ...c])}
                  onOrdered={patchOrder}
                />
              ) : (
                <Positions
                  open={openTrades}
                  closed={closedTrades}
                  pending={orders}
                  onCancel={cancelOrder}
                  onRepeat={repeatTrade}
                  loading={!tradesLoaded}
                />
              )}
            </div>
          </>
        )}
      </section>

      {isDesktop && (
        <aside className="flex w-72 shrink-0 flex-col gap-2">
          <div className="shrink-0">
            {ticketConfig.hotkeys && (
              <button
                onClick={() => setHelpOpen(true)}
                className="self-end rounded-md px-1.5 py-0.5 text-[10px] font-medium text-slate-500 hover:text-slate-300"
              >
                Shortcuts (?)
              </button>
            )}
            <TradeTicket
              ref={ticketRef}
              asset={asset}
              onPlaced={(trade) => setOpenTrades((c) => [trade, ...c])}
              onOrdered={patchOrder}
            />
          </div>
          <div className="min-h-0 flex-1">
            <Positions
              open={openTrades}
              closed={closedTrades}
              pending={orders}
              onCancel={cancelOrder}
              onRepeat={repeatTrade}
              loading={!tradesLoaded}
            />
          </div>
        </aside>
      )}

      {marketsOpen && (
        <div className="fixed inset-0 z-50 flex flex-col md:hidden">
          <button
            type="button"
            aria-label="Close market list"
            onClick={() => setMarketsOpen(false)}
            className="absolute inset-0 h-full w-full cursor-default bg-ink-900/80 backdrop-blur"
          />
          <div className="relative mt-auto h-[70%] rounded-t-2xl border-t border-ink-600 bg-ink-800">
            <div className="flex items-center justify-between px-4 py-3">
              <p className="text-sm font-semibold">Markets</p>
              <button onClick={() => setMarketsOpen(false)} className="text-xs text-slate-400">
                Close
              </button>
            </div>
            <div className="h-[calc(100%-3rem)]">
              <AssetPicker onPicked={() => setMarketsOpen(false)} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
