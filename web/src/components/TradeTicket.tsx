import { useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { duration as fmtDuration, dateTime, money, untilShort } from '../lib/format';
import { useAuth, activeBalance } from '../store/auth';
import { useTradingAccount } from '../store/tradingAccount';
import { useMarket } from '../store/market';
import { toast } from '../store/toast';
import type { Asset, ClockSlot, Trade } from '../lib/types';

/** A clock boundary as a trader reads it: 13:05, in their own timezone. */
function clockLabel(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/** Seconds as m:ss, for the countdown to a boundary's cut-off. */
function countdown(seconds: number): string {
  const safe = Math.max(Math.floor(seconds), 0);
  if (safe < 60) return `${safe}s`;
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}

/** Server-side refusals that depend on what is already open, not on the form. */
const RISK_CODES = new Set(['user_exposure_limit', 'market_exposure_limit']);
import { IconArrowDown, IconArrowUp } from './Icons';

interface Props {
  asset: Asset | undefined;
  onPlaced: (trade: Trade) => void;
}

const QUICK_AMOUNTS = [10, 25, 50, 100, 250, 500];

/** Stake + expiry + direction: the order ticket that places a binary option. */
export function TradeTicket({ asset, onPlaced }: Props) {
  const { user, patchBalance } = useAuth();
  const { tournamentId, tournamentName, tournamentBalance, setBalance } = useTradingAccount();
  const platformDurations = useMarket((s) => s.durations);
  const expiryConfig = useMarket((s) => s.expiry);
  const selectSymbol = useMarket((s) => s.selectSymbol);
  const [amount, setAmount] = useState(10);
  const [durationSec, setDurationSec] = useState(60);
  const [busy, setBusy] = useState<'UP' | 'DOWN' | null>(null);
  const [limitNotice, setLimitNotice] = useState<string | null>(null);
  const [expiryMode, setExpiryMode] = useState<'DURATION' | 'CLOCK'>('DURATION');
  const [slots, setSlots] = useState<ClockSlot[]>(expiryConfig.clock.slots);
  const [clockExpiresAt, setClockExpiresAt] = useState<number | null>(null);
  // a countdown has to tick, and the server owns the boundaries, so the list is
  // re-fetched as it ages rather than extrapolated in the browser
  const [tick, setTick] = useState(() => Date.now());

  // a market may offer a narrower set of durations than the platform
  const offered = asset?.durations?.length ? asset.durations : platformDurations;
  const modes = expiryConfig.modes;

  useEffect(() => {
    if (!offered.length) return;
    if (!offered.includes(durationSec)) setDurationSec(offered[1] ?? offered[0]);
  }, [offered, durationSec]);

  useEffect(() => {
    if (expiryMode !== 'CLOCK') return;
    const beat = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(beat);
  }, [expiryMode]);

  // refresh the boundaries when the soonest one is about to stop accepting, and
  // on a slow heartbeat so a ticket left open does not go stale
  useEffect(() => {
    if (expiryMode !== 'CLOCK') return;
    let cancelled = false;
    const pull = async () => {
      try {
        const data = await api.get<{ slots: ClockSlot[] }>('/trades/expiries');
        if (!cancelled) setSlots(data.slots);
      } catch {
        /* the existing list stays; the countdown will ask again */
      }
    };
    void pull();
    const timer = setInterval(() => void pull(), 20_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [expiryMode]);

  // a limit is measured against the stake and the market, so changing either
  // makes the old refusal meaningless
  useEffect(() => {
    setLimitNotice(null);
  }, [amount, asset?.symbol]);

  // boundaries that are still buyable at this second, soonest first
  const liveSlots = slots
    .map((slot) => ({ ...slot, secondsToClose: Math.ceil((slot.closesAt - tick) / 1000) }))
    .filter((slot) => slot.secondsToClose > 0);
  const selectedSlot = liveSlots.find((slot) => slot.expiresAt === clockExpiresAt) ?? liveSlots[0];

  if (!asset || !user) {
    return <div className="card h-full animate-pulse bg-ink-800/60" />;
  }

  const balance = tournamentId ? (tournamentBalance ?? 0) : activeBalance(user);
  const stake = Math.round(amount * 100);
  const profit = Math.floor((stake * asset.payoutPct) / 100);

  // the base payout and what moved it, for the line under the figure
  const base = asset.basePayoutPct ?? asset.payoutPct;
  const adjustments = asset.payoutAdjustments ?? [];
  const adjusted = adjustments.length > 0 && base !== asset.payoutPct;
  const adjustmentReason = adjustments.map((rule) => rule.name).join(', ');
  // A risk limit is the server's to know: it depends on what everyone holds.
  // When one refuses a stake, the reason stays on the ticket rather than
  // vanishing with the toast, until the trader changes the stake.
  const marketClosed = !asset.isOpen;
  const tooSmall = stake < asset.minStake;
  const tooLarge = stake > asset.maxStake;
  const insufficient = stake > balance;
  // in clock mode there is nothing to buy until a boundary is open
  const noSlot = expiryMode === 'CLOCK' && !selectedSlot;
  const blocked = marketClosed || tooSmall || tooLarge || insufficient || noSlot;

  const place = async (direction: 'UP' | 'DOWN') => {
    if (blocked || busy) return;
    setBusy(direction);
    setLimitNotice(null);
    try {
      const data = await api.post<{
        trade: Trade;
        balances: { demoBalance: number; realBalance: number };
        tournamentBalance: number | null;
      }>('/trades', {
        symbol: asset.symbol,
        expiryMode,
        ...(expiryMode === 'CLOCK' ? { expiresAt: selectedSlot?.expiresAt } : { durationSec }),
        direction,
        amount,
        accountType: tournamentId ? 'TOURNAMENT' : user.activeAccount,
        ...(tournamentId ? { tournamentId } : {}),
      });
      if (tournamentId && data.tournamentBalance != null) setBalance(data.tournamentBalance);
      else
        patchBalance(
          user.activeAccount,
          user.activeAccount === 'DEMO' ? data.balances.demoBalance : data.balances.realBalance,
        );
      onPlaced(data.trade);
      toast.info(
        `${direction === 'UP' ? 'Higher' : 'Lower'} · ${asset.symbol}`,
        `${money(stake)} at ${data.trade.entryPrice} · expires in ${fmtDuration(data.trade.durationSec)}`,
      );
    } catch (err) {
      if (err instanceof ApiError && RISK_CODES.has(err.code)) setLimitNotice(err.message);
      toast.error('Trade rejected', err instanceof ApiError ? err.message : 'Please try again');
    } finally {
      setBusy(null);
    }
  };

  if (marketClosed) {
    return (
      <div className="card flex h-full flex-col items-center justify-center gap-3 p-5 text-center">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-ink-600 text-slate-400">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <div>
          <p className="text-sm font-semibold">{asset.pair.replace(' (OTC)', '')} is closed</p>
          <p className="mt-1 text-xs text-slate-400">
            {asset.holiday
              ? `Closed for a market holiday (${asset.holiday}).`
              : asset.nextOpen
                ? `Opens ${untilShort(asset.nextOpen)} — ${dateTime(asset.nextOpen)}`
                : 'This market is not trading right now.'}
          </p>
          {asset.schedule && <p className="mt-1 text-[10px] text-slate-500">{asset.schedule.hours}</p>}
        </div>
        {asset.otcAlternative && (
          <button onClick={() => selectSymbol(asset.otcAlternative!)} className="btn-primary text-xs">
            Trade the OTC market instead
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="card flex h-full flex-col gap-3 p-3">
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wide text-slate-400">Payout</p>
          <p className="text-lg font-bold text-up">{asset.payoutPct}%</p>
          {/* when a rule has moved the payout, say so rather than leave the
              trader wondering why the number changed */}
          {adjusted && (
            <p className="truncate text-[10px] text-slate-400" title={adjustmentReason}>
              <span className={asset.payoutPct < base ? 'text-down' : 'text-up'}>
                {asset.payoutPct < base ? '▼' : '▲'} {base}% base
              </span>{' '}
              · {adjustmentReason}
            </p>
          )}
        </div>
        <div className="text-right">
          <p className="text-[10px] uppercase tracking-wide text-slate-400">Profit</p>
          <p className="tabular text-lg font-bold text-slate-100">{money(profit)}</p>
        </div>
      </div>

      <fieldset>
        <legend className="label">Expiry</legend>

        {/* the mode switch only appears when the platform offers both */}
        {modes.length > 1 && (
          <div className="mb-2 grid grid-cols-2 gap-1.5">
            {modes.map((mode) => (
              <button
                key={mode}
                onClick={() => setExpiryMode(mode)}
                aria-pressed={expiryMode === mode}
                className={`rounded-lg py-1.5 text-[11px] font-semibold uppercase tracking-wide transition ${
                  expiryMode === mode ? 'bg-ink-600 text-white' : 'bg-ink-700/60 text-slate-400'
                }`}
              >
                {mode === 'DURATION' ? 'Duration' : 'Clock time'}
              </button>
            ))}
          </div>
        )}

        {expiryMode === 'DURATION' ? (
          <div className="grid grid-cols-4 gap-1.5">
            {offered.slice(0, 8).map((seconds) => (
              <button
                key={seconds}
                onClick={() => setDurationSec(seconds)}
                aria-pressed={durationSec === seconds}
                className={`rounded-lg py-2 text-xs font-semibold transition ${
                  durationSec === seconds
                    ? 'bg-accent text-white'
                    : 'bg-ink-700 text-slate-300 hover:bg-ink-600'
                }`}
              >
                {fmtDuration(seconds)}
              </button>
            ))}
          </div>
        ) : liveSlots.length === 0 ? (
          <p className="rounded-lg bg-ink-700/60 px-3 py-2 text-xs text-slate-400">
            No clock expiry is open for purchase right now. The next one appears in a moment.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-1.5">
              {liveSlots.slice(0, 6).map((slot) => {
                const active = selectedSlot?.expiresAt === slot.expiresAt;
                return (
                  <button
                    key={slot.expiresAt}
                    onClick={() => setClockExpiresAt(slot.expiresAt)}
                    aria-pressed={active}
                    className={`rounded-lg px-2 py-2 text-xs font-semibold transition ${
                      active ? 'bg-accent text-white' : 'bg-ink-700 text-slate-300 hover:bg-ink-600'
                    }`}
                  >
                    <span className="tabular">{clockLabel(slot.expiresAt)}</span>
                    {/* time left to buy this boundary, not time to expiry */}
                    <span
                      className={`mt-0.5 block text-[10px] font-normal tabular ${
                        slot.secondsToClose <= 10 ? 'text-down' : active ? 'text-white/70' : 'text-slate-500'
                      }`}
                    >
                      {countdown(slot.secondsToClose)} to buy
                    </span>
                  </button>
                );
              })}
            </div>
            {selectedSlot && (
              <p className="mt-1.5 text-[11px] text-slate-500">
                Expires at {clockLabel(selectedSlot.expiresAt)} · {fmtDuration(selectedSlot.durationSec)} from
                now
              </p>
            )}
          </>
        )}
      </fieldset>

      <fieldset>
        <legend className="label">Investment</legend>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setAmount((v) => Math.max(asset.minStake / 100, Math.round((v - 10) * 100) / 100))}
            className="btn-ghost !px-3 !py-2 text-base"
            aria-label="Decrease amount"
          >
            −
          </button>
          <div className="relative flex-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">$</span>
            <input
              type="number"
              inputMode="decimal"
              value={amount}
              min={asset.minStake / 100}
              max={asset.maxStake / 100}
              onChange={(e) => setAmount(Math.max(0, Number(e.target.value)))}
              className="field tabular !pl-7 text-center font-semibold"
            />
          </div>
          <button
            onClick={() => setAmount((v) => Math.round((v + 10) * 100) / 100)}
            className="btn-ghost !px-3 !py-2 text-base"
            aria-label="Increase amount"
          >
            +
          </button>
        </div>
        <div className="mt-1.5 grid grid-cols-6 gap-1">
          {QUICK_AMOUNTS.map((value) => (
            <button
              key={value}
              onClick={() => setAmount(value)}
              className={`rounded-md py-1.5 text-[11px] font-medium transition ${
                amount === value ? 'bg-ink-500 text-white' : 'bg-ink-700 text-slate-400 hover:text-slate-200'
              }`}
            >
              {value}
            </button>
          ))}
        </div>
      </fieldset>

      {!blocked && limitNotice && (
        <p className="rounded-lg bg-down-soft px-3 py-2 text-xs text-down">{limitNotice}</p>
      )}

      {blocked && (
        <p className="rounded-lg bg-down-soft px-3 py-2 text-xs text-down">
          {insufficient
            ? `Not enough balance — you have ${money(balance)}`
            : tooSmall
              ? `Minimum investment is ${money(asset.minStake)}`
              : `Maximum investment is ${money(asset.maxStake)}`}
        </p>
      )}

      <div className="mt-auto grid grid-cols-2 gap-2 md:grid-cols-1">
        <button
          onClick={() => void place('UP')}
          disabled={blocked || busy !== null}
          className="btn-up !py-3.5 text-base"
        >
          <IconArrowUp className="h-5 w-5" />
          Higher
        </button>
        <button
          onClick={() => void place('DOWN')}
          disabled={blocked || busy !== null}
          className="btn-down !py-3.5 text-base"
        >
          <IconArrowDown className="h-5 w-5" />
          Lower
        </button>
      </div>
      <p className="text-center text-[10px] text-slate-500">
        {tournamentId
          ? `${tournamentName ?? 'Tournament'} chips — prizes pay out in real money`
          : user.activeAccount === 'DEMO'
            ? 'Practice funds — no real money at risk'
            : 'Live account'}
      </p>
    </div>
  );
}
