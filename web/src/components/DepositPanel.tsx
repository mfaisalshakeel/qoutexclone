import { useEffect, useMemo, useState } from 'react';
import { ApiError, api } from '../lib/api';
import { countdown, money, shortHash } from '../lib/format';
import { toast } from '../store/toast';
import { useAuth } from '../store/auth';
import { CopyButton } from './Copy';
import { QR } from './QR';
import type { Deposit, PaymentMethod } from '../lib/types';

interface Props {
  methods: PaymentMethod[];
  mockChain: boolean;
  deposits: Deposit[];
  onChanged: () => void;
}

const STEPS: Record<Deposit['status'], number> = {
  AWAITING_PAYMENT: 0,
  CONFIRMING: 1,
  COMPLETED: 2,
  REJECTED: -1,
  EXPIRED: -1,
};

export function DepositPanel({ methods, mockChain, deposits, onChanged }: Props) {
  const refreshUser = useAuth((s) => s.refreshUser);
  const [index, setIndex] = useState(0);
  const [amount, setAmount] = useState(100);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [, tick] = useState(0);

  const method = methods[index];
  const pending = useMemo(
    () => deposits.find((d) => d.status === 'AWAITING_PAYMENT' || d.status === 'CONFIRMING'),
    [deposits],
  );

  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  if (!method) return <div className="card h-40 animate-pulse" />;

  const cryptoEstimate = amount > 0 && method.rate > 0 ? (amount / method.rate).toFixed(method.decimals) : '0';
  const belowMin = amount < method.minDepositUsd;

  const create = async () => {
    setError('');
    setBusy(true);
    try {
      await api.post<{ deposit: Deposit }>('/wallet/deposits', {
        currency: method.currency,
        network: method.network,
        amount,
      });
      onChanged();
      toast.info('Deposit address ready', `Send exactly the amount shown to complete the deposit`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the deposit');
    } finally {
      setBusy(false);
    }
  };

  const simulate = async (id: string) => {
    try {
      await api.post(`/wallet/deposits/${id}/simulate-payment`);
      onChanged();
      toast.info('Payment broadcast', 'Waiting for network confirmations');
    } catch (err) {
      toast.error('Could not simulate', err instanceof ApiError ? err.message : undefined);
    }
  };

  if (pending) {
    const step = STEPS[pending.status];
    return (
      <div className="space-y-4">
        <div className="card p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-400">Awaiting deposit</p>
              <p className="text-lg font-bold">
                {pending.cryptoAmount} {pending.currency}
              </p>
              <p className="text-xs text-slate-500">
                {pending.networkLabel} · rate locked at ${pending.rate.toLocaleString()} /{pending.currency}
              </p>
            </div>
            <span className="chip bg-accent-soft text-accent">
              {pending.status === 'CONFIRMING'
                ? `Confirming ${pending.confirmations}/${pending.requiredConf}`
                : `Expires in ${countdown(pending.expiresAt)}`}
            </span>
          </div>

          <ol className="my-5 flex items-center gap-2 text-[11px]">
            {['Send payment', 'Confirming', 'Credited'].map((label, i) => (
              <li key={label} className="flex flex-1 items-center gap-2">
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                    i <= step ? 'bg-accent text-white' : 'bg-ink-600 text-slate-400'
                  } ${i === step ? 'animate-ring' : ''}`}
                >
                  {i + 1}
                </span>
                <span className={i <= step ? 'text-slate-200' : 'text-slate-500'}>{label}</span>
                {i < 2 && <span className={`h-px flex-1 ${i < step ? 'bg-accent' : 'bg-ink-600'}`} />}
              </li>
            ))}
          </ol>

          <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
            <QR value={pending.address} />
            <div className="w-full min-w-0 space-y-3">
              <div>
                <p className="label">Send to this {pending.networkLabel} address</p>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded-lg bg-ink-700 px-3 py-2.5 font-mono text-xs">
                    {pending.address}
                  </code>
                  <CopyButton value={pending.address} />
                </div>
              </div>
              <div>
                <p className="label">Exact amount</p>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 rounded-lg bg-ink-700 px-3 py-2.5 font-mono text-xs">
                    {pending.cryptoAmount} {pending.currency}
                  </code>
                  <CopyButton value={pending.cryptoAmount} />
                </div>
              </div>
              <p className="text-[11px] leading-relaxed text-slate-500">
                Send only {pending.currency} over {pending.networkLabel} to this address. Funds are credited after{' '}
                {pending.requiredConf} network confirmations.
              </p>
              {pending.txHash && (
                <p className="text-[11px] text-slate-400">
                  Transaction <span className="font-mono">{shortHash(pending.txHash, 10)}</span>
                </p>
              )}
              {mockChain && pending.status === 'AWAITING_PAYMENT' && (
                <button onClick={() => void simulate(pending.id)} className="btn-ghost w-full text-xs">
                  Simulate the incoming payment (demo mode)
                </button>
              )}
            </div>
          </div>
        </div>
        <button
          onClick={() => {
            onChanged();
            void refreshUser();
          }}
          className="btn-ghost w-full"
        >
          Refresh status
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="label">Choose a coin and network</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {methods.map((m, i) => (
            <button
              key={`${m.currency}-${m.network}`}
              onClick={() => setIndex(i)}
              className={`flex items-center gap-3 rounded-xl border p-3 text-left transition ${
                i === index ? 'border-accent bg-accent-soft' : 'border-ink-600 bg-ink-800 hover:border-ink-500'
              }`}
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-ink-600 text-[10px] font-bold">
                {m.currency}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold">{m.currency}</span>
                <span className="block text-[11px] text-slate-400">{m.label}</span>
              </span>
              <span className="ml-auto text-right text-[11px] text-slate-500">
                min ${m.minDepositUsd}
                <span className="block">{m.confirmations} conf</span>
              </span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="label" htmlFor="deposit-amount">
          Amount to deposit (USD)
        </label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">$</span>
          <input
            id="deposit-amount"
            type="number"
            inputMode="decimal"
            min={method.minDepositUsd}
            value={amount}
            onChange={(e) => setAmount(Number(e.target.value))}
            className="field tabular !pl-7 text-lg font-semibold"
          />
        </div>
        <div className="mt-2 grid grid-cols-4 gap-1.5">
          {[50, 100, 250, 500].map((value) => (
            <button
              key={value}
              onClick={() => setAmount(value)}
              className={`rounded-lg py-2 text-xs font-semibold transition ${
                amount === value ? 'bg-ink-500 text-white' : 'bg-ink-700 text-slate-300 hover:bg-ink-600'
              }`}
            >
              ${value}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-slate-400">
          You will send ≈{' '}
          <span className="font-semibold text-slate-200">
            {cryptoEstimate} {method.currency}
          </span>{' '}
          · credited as {money(Math.round(amount * 100))}
        </p>
      </div>

      {belowMin && (
        <p className="rounded-lg bg-down-soft px-3 py-2 text-xs text-down">
          Minimum deposit on {method.label} is ${method.minDepositUsd}.
        </p>
      )}
      {error && <p className="rounded-lg bg-down-soft px-3 py-2 text-xs text-down">{error}</p>}

      <button onClick={() => void create()} disabled={busy || belowMin} className="btn-primary w-full !py-3">
        {busy ? 'Creating…' : 'Get deposit address'}
      </button>
    </div>
  );
}
