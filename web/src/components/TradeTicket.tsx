import { useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { duration as fmtDuration, dateTime, money, untilShort } from '../lib/format';
import { useAuth, activeBalance } from '../store/auth';
import { useTradingAccount } from '../store/tradingAccount';
import { useMarket } from '../store/market';
import { toast } from '../store/toast';
import type { Asset, Trade } from '../lib/types';
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
  const durations = useMarket((s) => s.durations);
  const selectSymbol = useMarket((s) => s.selectSymbol);
  const [amount, setAmount] = useState(10);
  const [durationSec, setDurationSec] = useState(60);
  const [busy, setBusy] = useState<'UP' | 'DOWN' | null>(null);

  useEffect(() => {
    if (durations.length && !durations.includes(durationSec)) setDurationSec(durations[1] ?? durations[0]);
  }, [durations, durationSec]);

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
  const marketClosed = !asset.isOpen;
  const tooSmall = stake < asset.minStake;
  const tooLarge = stake > asset.maxStake;
  const insufficient = stake > balance;
  const blocked = marketClosed || tooSmall || tooLarge || insufficient;

  const place = async (direction: 'UP' | 'DOWN') => {
    if (blocked || busy) return;
    setBusy(direction);
    try {
      const data = await api.post<{
        trade: Trade;
        balances: { demoBalance: number; realBalance: number };
        tournamentBalance: number | null;
      }>('/trades', {
        symbol: asset.symbol,
        direction,
        amount,
        durationSec,
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
        `${money(stake)} at ${data.trade.entryPrice} · expires in ${fmtDuration(durationSec)}`,
      );
    } catch (err) {
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
        <div className="grid grid-cols-4 gap-1.5">
          {durations.slice(0, 8).map((seconds) => (
            <button
              key={seconds}
              onClick={() => setDurationSec(seconds)}
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
