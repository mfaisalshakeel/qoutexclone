import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { realtime } from '../lib/ws';
import { percent, price } from '../lib/format';
import { assetOf, useMarket } from '../store/market';
import { useAuth } from '../store/auth';
import { AssetPicker } from '../components/AssetPicker';
import { PriceChart } from '../components/PriceChart';
import { Positions } from '../components/Positions';
import { TradeTicket } from '../components/TradeTicket';
import type { Trade } from '../lib/types';

export function Terminal() {
  const { assets, prices, symbol, timeframe, timeframes, setTimeframe, load, loaded } = useMarket();
  const user = useAuth((s) => s.user);
  const [openTrades, setOpenTrades] = useState<Trade[]>([]);
  const [closedTrades, setClosedTrades] = useState<Trade[]>([]);
  const [mobilePanel, setMobilePanel] = useState<'trade' | 'positions'>('trade');
  const [marketsOpen, setMarketsOpen] = useState(false);

  const asset = useMemo(() => assetOf(symbol, assets), [symbol, assets]);
  const livePrice = prices[symbol] ?? asset?.price ?? null;
  const accountType = user?.activeAccount ?? 'DEMO';

  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  const loadTrades = useCallback(async () => {
    const [open, closed] = await Promise.all([
      api.get<{ trades: Trade[] }>(`/trades?status=OPEN&accountType=${accountType}`),
      api.get<{ trades: Trade[] }>(`/trades?status=CLOSED&accountType=${accountType}&limit=30`),
    ]);
    setOpenTrades(open.trades);
    setClosedTrades(closed.trades);
  }, [accountType]);

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

  const changePct = asset?.changePct ?? 0;

  return (
    <div className="flex flex-col gap-2 p-2 md:h-[calc(100dvh-3.5rem)] md:flex-row">
      {/* markets — rail on desktop, sheet on mobile */}
      <aside className="card hidden w-60 shrink-0 md:block">
        <AssetPicker />
      </aside>

      <section className="flex min-h-0 flex-1 flex-col gap-2">
        <header className="card flex shrink-0 items-center gap-3 p-2.5">
          <button
            onClick={() => setMarketsOpen(true)}
            className="flex items-center gap-2 rounded-lg px-1 py-0.5 text-left md:pointer-events-none"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-ink-600 text-[10px] font-bold text-slate-300">
              {asset?.base ?? '—'}
            </span>
            <span>
              <span className="block text-sm font-bold">{asset?.name ?? symbol}</span>
              <span className="block text-[10px] text-slate-500">
                {symbol} · payout {asset?.payoutPct ?? 0}%
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
            <span className={`tabular block text-[11px] ${changePct >= 0 ? 'text-up' : 'text-down'}`}>
              {percent(changePct)}
            </span>
          </div>

          <div className="ml-auto hidden gap-1 sm:flex">
            {timeframes.map((tf) => (
              <button
                key={tf}
                onClick={() => setTimeframe(tf)}
                className={`rounded-md px-2.5 py-1.5 text-xs font-semibold transition ${
                  timeframe === tf ? 'bg-ink-600 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {tf}
              </button>
            ))}
          </div>
        </header>

        <div className="card h-[42dvh] min-h-[240px] overflow-hidden md:h-auto md:flex-1">
          {asset && (
            <PriceChart symbol={symbol} timeframe={timeframe} precision={asset.precision} trades={openTrades} />
          )}
        </div>

        {/* mobile: ticket / positions switch */}
        <div className="grid shrink-0 grid-cols-2 gap-1 md:hidden">
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
        <div className="md:hidden">
          {mobilePanel === 'trade' ? (
            <TradeTicket asset={asset} onPlaced={(trade) => setOpenTrades((c) => [trade, ...c])} />
          ) : (
            <Positions open={openTrades} closed={closedTrades} />
          )}
        </div>
      </section>

      <aside className="hidden w-72 shrink-0 flex-col gap-2 md:flex">
        <div className="shrink-0">
          <TradeTicket asset={asset} onPlaced={(trade) => setOpenTrades((c) => [trade, ...c])} />
        </div>
        <div className="min-h-0 flex-1">
          <Positions open={openTrades} closed={closedTrades} />
        </div>
      </aside>

      {marketsOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-ink-900/80 backdrop-blur md:hidden" onClick={() => setMarketsOpen(false)}>
          <div className="mt-auto h-[70%] rounded-t-2xl border-t border-ink-600 bg-ink-800" onClick={(e) => e.stopPropagation()}>
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
