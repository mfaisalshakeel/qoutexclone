import { useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { duration as fmtDuration, money } from '../lib/format';
import { useAuth, activeBalance } from '../store/auth';
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
  const durations = useMarket((s) => s.durations);
  const [amount, setAmount] = useState(10);
  const [durationSec, setDurationSec] = useState(60);
  const [busy, setBusy] = useState<'UP' | 'DOWN' | null>(null);

  useEffect(() => {
    if (durations.length && !durations.includes(durationSec)) setDurationSec(durations[1] ?? durations[0]);
  }, [durations, durationSec]);

  if (!asset || !user) {
    return <div className="card h-full animate-pulse bg-ink-800/60" />;
  }

  const balance = activeBalance(user);
  const stake = Math.round(amount * 100);
  const profit = Math.floor((stake * asset.payoutPct) / 100);
  const tooSmall = stake < asset.minStake;
  const tooLarge = stake > asset.maxStake;
  const insufficient = stake > balance;
  const blocked = tooSmall || tooLarge || insufficient;

  const place = async (direction: 'UP' | 'DOWN') => {
    if (blocked || busy) return;
    setBusy(direction);
    try {
      const data = await api.post<{ trade: Trade; balances: { demoBalance: number; realBalance: number } }>('/trades', {
        symbol: asset.symbol,
        direction,
        amount,
        durationSec,
        accountType: user.activeAccount,
      });
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

  return (
    <div className="card flex h-full flex-col gap-3 p-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-slate-400">Payout</p>
          <p className="text-lg font-bold text-up">{asset.payoutPct}%</p>
        </div>
        <div className="text-right">
          <p className="text-[10px] uppercase tracking-wide text-slate-400">Profit</p>
          <p className="tabular text-lg font-bold text-slate-100">{money(profit)}</p>
        </div>
      </div>

      <div>
        <label className="label">Expiry</label>
        <div className="grid grid-cols-4 gap-1.5">
          {durations.slice(0, 8).map((seconds) => (
            <button
              key={seconds}
              onClick={() => setDurationSec(seconds)}
              className={`rounded-lg py-2 text-xs font-semibold transition ${
                durationSec === seconds ? 'bg-accent text-white' : 'bg-ink-700 text-slate-300 hover:bg-ink-600'
              }`}
            >
              {fmtDuration(seconds)}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="label">Investment</label>
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
      </div>

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
        <button onClick={() => void place('UP')} disabled={blocked || busy !== null} className="btn-up !py-3.5 text-base">
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
        {user.activeAccount === 'DEMO' ? 'Practice funds — no real money at risk' : 'Live account'}
      </p>
    </div>
  );
}
