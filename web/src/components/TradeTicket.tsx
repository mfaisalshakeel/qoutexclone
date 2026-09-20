import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { duration as fmtDuration, dateTime, money, price, untilShort } from '../lib/format';
import { useAuth, activeBalance } from '../store/auth';
import { useTradingAccount } from '../store/tradingAccount';
import { useMarket } from '../store/market';
import { useSettings } from '../store/settings';
import { toast } from '../store/toast';
import type { Asset, ClockSlot, PendingOrder, Trade } from '../lib/types';

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

/** A datetime-local value for an instant, which the input needs in local time. */
function localInput(epochMs: number): string {
  const at = new Date(epochMs);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

/** Server-side refusals that depend on what is already open, not on the form. */
const RISK_CODES = new Set(['user_exposure_limit', 'market_exposure_limit']);
import { IconArrowDown, IconArrowUp } from './Icons';
import { Sentiment } from './Sentiment';

interface Props {
  asset: Asset | undefined;
  onPlaced: (trade: Trade) => void;
  /** Called when a pending order is created, so the list can show it at once. */
  onOrdered?: (order: PendingOrder) => void;
  /**
   * What the ticket currently holds, for anything that shows it elsewhere —
   * the phone's dock, which has to read the stake and the expiry without
   * owning them.
   */
  onSummary?: (summary: TicketSummary) => void;
}

/** The ticket's state as somewhere else needs to read it. */
export interface TicketSummary {
  /** Stake in cents. */
  stake: number;
  /** "1m", or a clock boundary as "13:05". */
  expiryLabel: string;
  payoutPct: number;
  /** What a win returns, in cents. */
  profit: number;
  /** Whether the two buy buttons would do anything. */
  tradable: boolean;
  placing: boolean;
  orderType: 'MARKET' | 'PENDING';
}

/** Shares of the active balance the shortcuts offer. */
const PERCENTAGES = [0.25, 0.5, 0.75, 1] as const;

/**
 * What a keyboard shortcut may do to the ticket.
 *
 * The ticket owns the stake and the expiry, so the shortcuts reach in through a
 * handle rather than having that state lifted into the terminal — the ticket
 * stays the one place that knows what a valid stake is.
 */
export interface TicketHandle {
  higher: () => void;
  lower: () => void;
  amountUp: () => void;
  amountDown: () => void;
  expiryUp: () => void;
  expiryDown: () => void;
}

/** Stake + expiry + direction: the order ticket that places a binary option. */
export const TradeTicket = forwardRef<TicketHandle, Props>(function TradeTicket(
  { asset, onPlaced, onOrdered, onSummary },
  ref,
) {
  const { user, patchBalance } = useAuth();
  const { tournamentId, tournamentName, tournamentBalance, setBalance } = useTradingAccount();
  const platformDurations = useMarket((s) => s.durations);
  const expiryConfig = useMarket((s) => s.expiry);
  const selectSymbol = useMarket((s) => s.selectSymbol);
  const prices = useMarket((s) => s.prices);
  const ticketConfig = useMarket((s) => s.ticket);
  const sentimentConfig = useMarket((s) => s.sentimentConfig);
  const statusCeiling =
    useSettings((s) => s.values['growth.statusMaxPayoutPct'] as number | undefined) ?? 100;
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
  const [orderType, setOrderType] = useState<'MARKET' | 'PENDING'>('MARKET');
  const [trigger, setTrigger] = useState<'PRICE' | 'TIME'>('PRICE');
  const [triggerPrice, setTriggerPrice] = useState('');
  const [triggerAt, setTriggerAt] = useState('');

  /**
   * The shortcut handle has to be stable and unconditional — hooks cannot sit
   * behind the early return below — so it forwards to the actions of whichever
   * render is current. Render assigns them; events only fire afterwards, so the
   * ref is never stale.
   */
  const actionsRef = useRef<TicketHandle | null>(null);
  useImperativeHandle(
    ref,
    () => ({
      higher: () => actionsRef.current?.higher(),
      lower: () => actionsRef.current?.lower(),
      amountUp: () => actionsRef.current?.amountUp(),
      amountDown: () => actionsRef.current?.amountDown(),
      expiryUp: () => actionsRef.current?.expiryUp(),
      expiryDown: () => actionsRef.current?.expiryDown(),
    }),
    [],
  );

  // a market may offer a narrower set of durations than the platform
  const offered = asset?.durations?.length ? asset.durations : platformDurations;
  const modes = expiryConfig.modes;
  const sentimentEnabled = sentimentConfig.enabled;
  const sentimentMinTrades = sentimentConfig.minTrades;
  const precision = asset?.precision ?? 2;
  const livePrice = asset ? (prices[asset.symbol] ?? asset.price ?? null) : null;

  // The market's own range is the authority; a preset or a percentage outside it
  // is never offered, so a trader cannot arrive at a stake that will be refused.
  const minCents = asset?.minStake ?? 100;
  const maxCents = asset?.maxStake ?? 500_000;
  const stepCents = ticketConfig.step;
  const clampCents = (cents: number) => Math.min(Math.max(Math.round(cents), minCents), maxCents);
  const presets = ticketConfig.presets.filter((cents) => cents >= minCents && cents <= maxCents);

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

  // a level has to start somewhere the trader can see; the live price is the
  // only sensible anchor, and it is only seeded once so typing is never fought
  useEffect(() => {
    if (orderType !== 'PENDING' || trigger !== 'PRICE') return;
    setTriggerPrice((current) => current || (livePrice != null ? livePrice.toFixed(precision) : ''));
  }, [orderType, trigger, livePrice, precision]);

  useEffect(() => {
    if (orderType !== 'PENDING' || trigger !== 'TIME') return;
    setTriggerAt((current) => current || localInput(Date.now() + 5 * 60_000));
  }, [orderType, trigger]);

  // switching market clears a level that belonged to the old one
  useEffect(() => {
    setTriggerPrice('');
  }, [asset?.symbol]);

  // boundaries that are still buyable at this second, soonest first
  const liveSlots = slots
    .map((slot) => ({ ...slot, secondsToClose: Math.ceil((slot.closesAt - tick) / 1000) }))
    .filter((slot) => slot.secondsToClose > 0);
  const selectedSlot = liveSlots.find((slot) => slot.expiresAt === clockExpiresAt) ?? liveSlots[0];

  // the dock on a phone shows the stake, the expiry and the payout without
  // holding any of them: the ticket stays the one place that knows what a
  // valid stake is, and simply says what it has
  const summary = useMemo<TicketSummary>(
    () => ({
      stake: Math.round(amount * 100),
      expiryLabel:
        expiryMode === 'CLOCK'
          ? selectedSlot
            ? clockLabel(selectedSlot.expiresAt)
            : '—'
          : fmtDuration(durationSec),
      payoutPct: asset?.payoutPct ?? 0,
      profit: Math.floor((Math.round(amount * 100) * (asset?.payoutPct ?? 0)) / 100),
      tradable: !!asset?.isOpen && !!user,
      placing: busy !== null,
      orderType,
    }),
    [amount, expiryMode, selectedSlot, durationSec, asset, user, busy, orderType],
  );

  useEffect(() => {
    onSummary?.(summary);
  }, [onSummary, summary]);

  if (!asset || !user) {
    return <div className="card h-full animate-pulse bg-ink-800/60" />;
  }

  const balance = tournamentId ? (tournamentBalance ?? 0) : activeBalance(user);
  const stake = Math.round(amount * 100);

  // a status bonus lifts this trader's own payout, and never inside a
  // tournament, where everyone trades on the same terms. The server decides
  // the number that is written into the position; this mirrors it so the
  // ticket quotes what the trade will actually pay.
  const statusBonus = tournamentId ? 0 : (user.statusLevel?.payoutBonus ?? 0);
  const payoutPct = Math.min(asset.payoutPct + statusBonus, statusCeiling);
  const profit = Math.floor((stake * payoutPct) / 100);

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
  // a level equal to the market is a market order, which the server refuses, so
  // the button says so before the round trip
  const levelNumber = Number(triggerPrice);
  const badLevel =
    orderType === 'PENDING' &&
    trigger === 'PRICE' &&
    (!Number.isFinite(levelNumber) || levelNumber <= 0 || (livePrice != null && levelNumber === livePrice));
  const badTime =
    orderType === 'PENDING' && trigger === 'TIME' && !(new Date(triggerAt).getTime() > Date.now());
  const blocked = marketClosed || tooSmall || tooLarge || insufficient || noSlot || badLevel || badTime;
  // a pending order is not funded until it fires, so a thin balance is only a
  // warning there rather than a block
  const pendingSide = orderType === 'PENDING' ? (levelNumber > (livePrice ?? 0) ? 'above' : 'below') : null;

  const submitOrder = async (direction: 'UP' | 'DOWN') => {
    setBusy(direction);
    setLimitNotice(null);
    try {
      const { order } = await api.post<{ order: PendingOrder }>('/trades/pending', {
        symbol: asset.symbol,
        direction,
        amount,
        trigger,
        ...(trigger === 'PRICE'
          ? { triggerPrice: Number(triggerPrice) }
          : { triggerAt: new Date(triggerAt).toISOString() }),
        expiryMode,
        ...(expiryMode === 'CLOCK' ? { expiresAt: selectedSlot?.expiresAt } : { durationSec }),
        accountType: tournamentId ? 'TOURNAMENT' : user.activeAccount,
        ...(tournamentId ? { tournamentId } : {}),
      });
      onOrdered?.(order);
      toast.success(
        'Order placed',
        trigger === 'PRICE'
          ? `${asset.symbol} ${direction} when the price reaches ${triggerPrice}`
          : `${asset.symbol} ${direction} at ${new Date(triggerAt).toLocaleTimeString()}`,
      );
    } catch (err) {
      toast.error('Order rejected', err instanceof ApiError ? err.message : 'Please try again');
    } finally {
      setBusy(null);
    }
  };

  /** Moves one place along whichever expiry list is showing. */
  const stepExpiry = (delta: number) => {
    if (expiryMode === 'CLOCK') {
      if (liveSlots.length === 0) return;
      const at = liveSlots.findIndex((slot) => slot.expiresAt === selectedSlot?.expiresAt);
      const next = Math.min(Math.max((at < 0 ? 0 : at) + delta, 0), liveSlots.length - 1);
      setClockExpiresAt(liveSlots[next].expiresAt);
      return;
    }
    if (offered.length === 0) return;
    const at = offered.indexOf(durationSec);
    const next = Math.min(Math.max((at < 0 ? 0 : at) + delta, 0), offered.length - 1);
    setDurationSec(offered[next]);
  };

  const place = async (direction: 'UP' | 'DOWN') => {
    if (blocked || busy) return;
    if (orderType === 'PENDING') return submitOrder(direction);
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

  // Every shortcut goes through the same setters the buttons use, so it can
  // never reach a stake or an expiry the UI would refuse.
  actionsRef.current = {
    higher: () => void place('UP'),
    lower: () => void place('DOWN'),
    amountUp: () => setAmount(clampCents(stake + stepCents) / 100),
    amountDown: () => setAmount(clampCents(stake - stepCents) / 100),
    expiryUp: () => stepExpiry(1),
    expiryDown: () => stepExpiry(-1),
  };

  if (marketClosed) {
    return (
      <div
        role="region"
        aria-label="Order ticket"
        className="card flex h-full flex-col items-center justify-center gap-3 p-5 text-center"
      >
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
    <div role="region" aria-label="Order ticket" className="card flex h-full flex-col gap-3 p-3">
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wide text-slate-400">Payout</p>
          <p className="text-lg font-bold text-up">{payoutPct}%</p>
          {statusBonus > 0 && payoutPct > asset.payoutPct && (
            <p className="truncate text-[10px] text-accent">
              +{payoutPct - asset.payoutPct}% {user.statusLevel?.name} bonus
            </p>
          )}
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

      {/* Market now, or an order that waits for a level or a time. A pending
          order holds no money while it waits, so it is priced and funded at the
          moment it fires, not now. */}
      <fieldset>
        <legend className="label">Order</legend>
        <div className="grid grid-cols-2 gap-1.5">
          {(['MARKET', 'PENDING'] as const).map((type) => (
            <button
              key={type}
              onClick={() => setOrderType(type)}
              aria-pressed={orderType === type}
              className={`rounded-lg py-1.5 text-[11px] font-semibold uppercase tracking-wide transition ${
                orderType === type ? 'bg-ink-600 text-white' : 'bg-ink-700/60 text-slate-400'
              }`}
            >
              {type === 'MARKET' ? 'Market' : 'Pending'}
            </button>
          ))}
        </div>

        {orderType === 'PENDING' && (
          <div className="mt-2 space-y-2 rounded-lg border border-ink-600 p-2">
            <div className="grid grid-cols-2 gap-1.5">
              {(['PRICE', 'TIME'] as const).map((kind) => (
                <button
                  key={kind}
                  onClick={() => setTrigger(kind)}
                  aria-pressed={trigger === kind}
                  className={`rounded-md py-1.5 text-[11px] font-semibold transition ${
                    trigger === kind ? 'bg-accent text-white' : 'bg-ink-700 text-slate-300'
                  }`}
                >
                  {kind === 'PRICE' ? 'At a price' : 'At a time'}
                </button>
              ))}
            </div>

            {trigger === 'PRICE' ? (
              <label className="block">
                <span className="text-[11px] text-slate-400">Open when the price reaches</span>
                <input
                  type="number"
                  inputMode="decimal"
                  step={1 / 10 ** precision}
                  value={triggerPrice}
                  onChange={(event) => setTriggerPrice(event.target.value)}
                  aria-label="Trigger price"
                  className="field tabular mt-1 text-center font-semibold"
                />
                <span className="mt-1 block text-[10px] text-slate-500">
                  {livePrice != null && `Market ${price(livePrice, precision)}`}
                  {!badLevel &&
                    pendingSide &&
                    ` · fires on the way ${pendingSide === 'above' ? 'up' : 'down'}`}
                </span>
              </label>
            ) : (
              <label className="block">
                <span className="text-[11px] text-slate-400">Open at</span>
                <input
                  type="datetime-local"
                  value={triggerAt}
                  onChange={(event) => setTriggerAt(event.target.value)}
                  aria-label="Trigger time"
                  className="field mt-1 text-center"
                />
              </label>
            )}
          </div>
        )}
      </fieldset>

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
            onClick={() => setAmount(clampCents(stake - stepCents) / 100)}
            disabled={stake <= minCents}
            className="btn-ghost !px-3 !py-2 text-base disabled:opacity-40"
            aria-label={`Decrease amount by ${money(stepCents)}`}
          >
            −
          </button>
          <div className="relative flex-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">$</span>
            <input
              type="number"
              inputMode="decimal"
              value={amount}
              min={minCents / 100}
              max={maxCents / 100}
              step={stepCents / 100}
              aria-label="Investment amount"
              onChange={(event) => setAmount(Math.max(0, Number(event.target.value)))}
              // typing is left alone; the value is pulled into range on blur so
              // an intermediate keystroke is never fought
              onBlur={() => setAmount(clampCents(Math.round(amount * 100)) / 100)}
              className="field tabular !pl-7 text-center font-semibold"
            />
          </div>
          <button
            onClick={() => setAmount(clampCents(stake + stepCents) / 100)}
            disabled={stake >= maxCents}
            className="btn-ghost !px-3 !py-2 text-base disabled:opacity-40"
            aria-label={`Increase amount by ${money(stepCents)}`}
          >
            +
          </button>
        </div>

        {presets.length > 0 && (
          <div className="mt-1.5 grid grid-cols-6 gap-1">
            {presets.map((cents) => (
              <button
                key={cents}
                onClick={() => setAmount(cents / 100)}
                aria-pressed={stake === cents}
                className={`rounded-md py-1.5 text-[11px] font-medium transition ${
                  stake === cents ? 'bg-ink-500 text-white' : 'bg-ink-700 text-slate-400 hover:text-slate-200'
                }`}
              >
                {cents % 100 === 0 ? cents / 100 : (cents / 100).toFixed(2)}
              </button>
            ))}
          </div>
        )}

        {/* a share of what the trader actually has, clamped to the market's
            range so the button never sets a stake that would be refused */}
        <div className="mt-1 grid grid-cols-4 gap-1">
          {PERCENTAGES.map((share) => {
            const target = clampCents(balance * share);
            const unreachable = balance * share < minCents;
            return (
              <button
                key={share}
                onClick={() => setAmount(target / 100)}
                disabled={unreachable}
                title={unreachable ? `Below this market's ${money(minCents)} minimum` : undefined}
                className={`rounded-md py-1.5 text-[11px] font-medium transition ${
                  !unreachable && stake === target
                    ? 'bg-ink-500 text-white'
                    : 'bg-ink-700/60 text-slate-400 hover:text-slate-200 disabled:opacity-40'
                }`}
              >
                {share === 1 ? 'All' : `${share * 100}%`}
              </button>
            );
          })}
        </div>

        <p className="mt-1 text-[10px] text-slate-500">
          {money(minCents)}–{money(maxCents)} on this market
        </p>
      </fieldset>

      {!blocked && limitNotice && (
        <p className="rounded-lg bg-down-soft px-3 py-2 text-xs text-down">{limitNotice}</p>
      )}

      {blocked && (
        <p className="rounded-lg bg-down-soft px-3 py-2 text-xs text-down">
          {badLevel
            ? livePrice != null && levelNumber === livePrice
              ? 'Pick a level above or below the market — that is a market order'
              : 'Enter a price level'
            : badTime
              ? 'Pick a time in the future'
              : insufficient
                ? `Not enough balance — you have ${money(balance)}`
                : tooSmall
                  ? `Minimum investment is ${money(asset.minStake)}`
                  : `Maximum investment is ${money(asset.maxStake)}`}
        </p>
      )}

      {/* what the crowd is doing, right where the direction is chosen */}
      {sentimentEnabled && (
        <div className="mt-auto">
          <Sentiment sentiment={asset.sentiment} minTrades={sentimentMinTrades} />
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 md:grid-cols-1">
        <button
          onClick={() => void place('UP')}
          disabled={blocked || busy !== null}
          className="btn-up !py-3.5 text-base"
        >
          <IconArrowUp className="h-5 w-5" />
          {orderType === 'PENDING' ? 'Order higher' : 'Higher'}
        </button>
        <button
          onClick={() => void place('DOWN')}
          disabled={blocked || busy !== null}
          className="btn-down !py-3.5 text-base"
        >
          <IconArrowDown className="h-5 w-5" />
          {orderType === 'PENDING' ? 'Order lower' : 'Lower'}
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
});
