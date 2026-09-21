import { useEffect, useState } from 'react';
import { ApiError, api } from '../lib/api';
import { dateTime, money, shortHash } from '../lib/format';
import { toast } from '../store/toast';
import { useAuth } from '../store/auth';
import type { PaymentMethod, Withdrawal, WithdrawalQuote } from '../lib/types';
import { MethodIcon } from './MethodIcon';
import { PaymentPanelSkeleton } from './Skeleton';

interface Props {
  methods: PaymentMethod[];
  withdrawals: Withdrawal[];
  onChanged: () => void;
}

const STATUS_TONE: Record<Withdrawal['status'], string> = {
  PENDING: 'bg-amber-400/10 text-amber-300',
  APPROVED: 'bg-accent-soft text-accent',
  PROCESSING: 'bg-accent-soft text-accent',
  COMPLETED: 'bg-up-soft text-up',
  REJECTED: 'bg-down-soft text-down',
  CANCELLED: 'bg-ink-600 text-slate-400',
};

export function WithdrawPanel({ methods, withdrawals, onChanged }: Props) {
  const { user, refreshUser } = useAuth();
  // a card cannot receive an arbitrary payout, so it never appears here even
  // though it is offered for deposits
  const payable = methods.filter((m) => m.payoutSupported);
  const [index, setIndex] = useState(0);
  const [address, setAddress] = useState('');
  const [amount, setAmount] = useState(50);
  const [quote, setQuote] = useState<WithdrawalQuote | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const method = payable[index];
  const isEwallet = method?.network === 'EWALLET';
  const available = user?.realBalance ?? 0;

  // live fee quote, debounced so typing does not hammer the API
  useEffect(() => {
    if (!method || !(amount > 0)) {
      setQuote(null);
      return;
    }
    const id = window.setTimeout(() => {
      const path = isEwallet
        ? `/wallet/withdrawals/provider-quote?methodKey=${method.network.toLowerCase()}-${method.currency.toLowerCase()}&amount=${amount}`
        : `/wallet/withdrawals/quote?currency=${method.currency}&network=${method.network}&amount=${amount}`;
      api
        .get<{ quote: WithdrawalQuote }>(path)
        .then(({ quote: q }) => setQuote(q))
        .catch(() => setQuote(null));
    }, 250);
    return () => window.clearTimeout(id);
  }, [method, isEwallet, amount]);

  if (!method) return <PaymentPanelSkeleton />;

  const cents = Math.round(amount * 100);
  const belowMin = quote ? cents < quote.minAmount : false;
  const overBalance = cents > available;
  const noNet = quote ? quote.netAmount <= 0 : false;
  const blocked = belowMin || overBalance || noNet || !address.trim();

  const submit = async () => {
    setError('');
    setBusy(true);
    try {
      if (isEwallet) {
        await api.post('/wallet/withdrawals/provider', { destination: address.trim(), amount });
      } else {
        await api.post('/wallet/withdrawals', {
          currency: method.currency,
          network: method.network,
          address: address.trim(),
          amount,
        });
      }
      setAddress('');
      onChanged();
      await refreshUser();
      toast.success('Withdrawal requested', 'You will be notified once it is processed');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not submit the withdrawal');
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (id: string) => {
    try {
      await api.post(`/wallet/withdrawals/${id}/cancel`);
      onChanged();
      await refreshUser();
      toast.info('Withdrawal cancelled', 'Funds returned to your balance');
    } catch (err) {
      toast.error('Could not cancel', err instanceof ApiError ? err.message : undefined);
    }
  };

  const pending = withdrawals.filter((w) => ['PENDING', 'APPROVED', 'PROCESSING'].includes(w.status));
  // a settled withdrawal keeps its timeline visible for a little while, so
  // "did that go through" has an answer without a trip to full history
  const recentSettled = withdrawals
    .filter((w) => w.status === 'COMPLETED' || w.status === 'REJECTED')
    .slice(0, RECENT_SETTLED);

  return (
    <div className="space-y-5">
      <div className="card flex items-center justify-between p-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-400">Available to withdraw</p>
          <p className="tabular text-xl font-bold">{money(available)}</p>
        </div>
        {(user?.lockedBalance ?? 0) > 0 && (
          <p className="text-right text-xs text-slate-400">
            {money(user!.lockedBalance)}
            <span className="block">on hold</span>
          </p>
        )}
      </div>

      <div>
        <p className="label">Withdraw to</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {payable.map((m, i) => (
            <button
              key={`${m.currency}-${m.network}`}
              onClick={() => setIndex(i)}
              className={`flex items-center gap-3 rounded-xl border p-3 text-left transition ${
                i === index
                  ? 'border-accent bg-accent-soft'
                  : 'border-ink-600 bg-ink-800 hover:border-ink-500'
              }`}
            >
              <MethodIcon currency={m.currency} network={m.network} />
              <span>
                <span className="block text-sm font-semibold">{m.currency}</span>
                <span className="block text-[11px] text-slate-400">{m.label}</span>
              </span>
              <span className="ml-auto text-right text-[11px] text-slate-500">
                {m.maxWithdrawUsd > 0
                  ? `$${m.minWithdrawUsd.toLocaleString()}–$${m.maxWithdrawUsd.toLocaleString()}`
                  : `min $${m.minWithdrawUsd}`}
                <span className="block">fee ${m.networkFeeUsd}</span>
              </span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="label" htmlFor="withdraw-address">
          {isEwallet ? 'E-wallet email' : `${method.label} address`}
        </label>
        <input
          id="withdraw-address"
          type={isEwallet ? 'email' : 'text'}
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          spellCheck={false}
          className="field font-mono !text-xs"
          placeholder={
            isEwallet
              ? 'you@example.com'
              : method.network === 'TRC20'
                ? 'T…'
                : method.network === 'ERC20'
                  ? '0x…'
                  : 'bc1…'
          }
        />
        <p className="mt-1.5 text-[11px] text-slate-500">
          {isEwallet
            ? 'The email address your e-wallet account uses.'
            : 'Double-check the network. Coins sent to an address on another network cannot be recovered.'}
        </p>
      </div>

      <div>
        <label className="label" htmlFor="withdraw-amount">
          Amount (USD)
        </label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">$</span>
          <input
            id="withdraw-amount"
            type="number"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(Number(e.target.value))}
            className="field tabular !pl-7 text-lg font-semibold"
          />
          <button
            onClick={() => setAmount(Math.floor(available) / 100)}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md bg-ink-600 px-2 py-1 text-[11px] font-semibold text-slate-300"
          >
            MAX
          </button>
        </div>
      </div>

      {quote && (
        <dl className="card space-y-2 p-4 text-sm">
          <Row label="You withdraw" value={money(quote.amount)} />
          <Row label={`Fee (network + ${method.currency})`} value={`− ${money(quote.fee)}`} />
          <div className="h-px bg-ink-600" />
          <Row
            label="You receive"
            value={`${quote.cryptoAmount} ${quote.currency}`}
            hint={`≈ ${money(Math.max(quote.netAmount, 0))} at $${quote.rate.toLocaleString()}`}
            strong
          />
        </dl>
      )}

      {(belowMin || overBalance || noNet) && (
        <p className="rounded-lg bg-down-soft px-3 py-2 text-xs text-down">
          {overBalance
            ? `You can withdraw up to ${money(available)}`
            : noNet
              ? 'Amount does not cover the network fee'
              : `Minimum withdrawal on ${method.label} is ${money(quote?.minAmount ?? 0)}`}
        </p>
      )}
      {error && <p className="rounded-lg bg-down-soft px-3 py-2 text-xs text-down">{error}</p>}

      <button onClick={() => void submit()} disabled={blocked || busy} className="btn-primary w-full !py-3">
        {busy ? 'Submitting…' : 'Request withdrawal'}
      </button>

      {pending.length > 0 && (
        <div>
          <p className="label">In progress</p>
          <ul className="space-y-3">
            {pending.map((w) => (
              <li key={w.id} className="card space-y-3 p-3">
                <div className="flex items-center gap-3">
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold">
                      {money(w.amount)} → {w.cryptoAmount} {w.currency}
                    </span>
                    <span className="block truncate font-mono text-[11px] text-slate-500">{w.address}</span>
                    <span className="block text-[11px] text-slate-500">{dateTime(w.createdAt)}</span>
                  </span>
                  {w.status === 'PENDING' && (
                    <button
                      onClick={() => void cancel(w.id)}
                      className="btn-ghost !px-2.5 !py-1.5 text-[11px]"
                    >
                      Cancel
                    </button>
                  )}
                </div>
                <WithdrawalTimeline withdrawal={w} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {recentSettled.length > 0 && (
        <div>
          <p className="label">Recently settled</p>
          <ul className="space-y-3">
            {recentSettled.map((w) => (
              <li key={w.id} className="card space-y-3 p-3">
                <div className="flex items-center gap-3">
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold">
                      {money(w.amount)} → {w.cryptoAmount} {w.currency}
                    </span>
                    <span className="block truncate font-mono text-[11px] text-slate-500">{w.address}</span>
                    <span className="block text-[11px] text-slate-500">{dateTime(w.createdAt)}</span>
                  </span>
                </div>
                <WithdrawalTimeline withdrawal={w} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** How many recently settled withdrawals still show their timeline. */
const RECENT_SETTLED = 3;

const TIMELINE_STEPS = ['Requested', 'Approved', 'Sent', 'Completed'] as const;

/**
 * Where a withdrawal stands, as steps rather than a single chip.
 *
 * Rejected and cancelled are dead ends, not steps four and five of the same
 * ladder, so they get their own terminal state with the reason attached
 * rather than being squeezed onto a line that implies progress.
 */
function WithdrawalTimeline({ withdrawal }: { withdrawal: Withdrawal }) {
  if (withdrawal.status === 'REJECTED' || withdrawal.status === 'CANCELLED') {
    return (
      <div className={`rounded-lg px-3 py-2 text-xs ${STATUS_TONE[withdrawal.status]}`}>
        <p className="font-semibold">
          {withdrawal.status === 'REJECTED' ? 'Rejected' : 'Cancelled'}
          {withdrawal.processedAt && ` · ${dateTime(withdrawal.processedAt)}`}
        </p>
        {withdrawal.adminNote && <p className="mt-0.5 text-slate-300">{withdrawal.adminNote}</p>}
      </div>
    );
  }

  const step = { PENDING: 0, APPROVED: 1, PROCESSING: 2, COMPLETED: 3 }[withdrawal.status];

  return (
    <div>
      <ol className="flex items-center gap-2 text-[11px]">
        {TIMELINE_STEPS.map((label, i) => (
          <li key={label} className="flex flex-1 items-center gap-2">
            <span
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold ${
                i <= step ? 'bg-accent text-white' : 'bg-ink-600 text-slate-400'
              } ${i === step ? 'animate-ring' : ''}`}
            >
              {i + 1}
            </span>
            <span className={i <= step ? 'text-slate-200' : 'text-slate-500'}>{label}</span>
            {i < TIMELINE_STEPS.length - 1 && (
              <span className={`h-px flex-1 ${i < step ? 'bg-accent' : 'bg-ink-600'}`} />
            )}
          </li>
        ))}
      </ol>
      {withdrawal.txHash && (
        <p className="mt-2 text-[11px] text-slate-500">
          {withdrawal.provider === 'EWALLET' ? 'Reference' : 'Transaction'}{' '}
          <span className="font-mono">{shortHash(withdrawal.txHash, 10)}</span>
        </p>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  hint,
  strong,
}: {
  label: string;
  value: string;
  hint?: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-xs text-slate-400">{label}</dt>
      <dd className="text-right">
        <span className={`tabular block ${strong ? 'text-base font-bold' : 'text-sm text-slate-200'}`}>
          {value}
        </span>
        {hint && <span className="block text-[11px] text-slate-500">{hint}</span>}
      </dd>
    </div>
  );
}
