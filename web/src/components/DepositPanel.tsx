import { useEffect, useMemo, useState } from 'react';
import { ApiError, api } from '../lib/api';
import { countdown, money, shortHash } from '../lib/format';
import { toast } from '../store/toast';
import { useAuth } from '../store/auth';
import { CopyButton } from './Copy';
import { MethodIcon } from './MethodIcon';
import { QR } from './QR';
import type { Deposit, PaymentMethod } from '../lib/types';
import { PaymentPanelSkeleton } from './Skeleton';

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

interface BonusOffer {
  id: string;
  key: string;
  name: string;
  description: string;
  percent: number;
  maxBonusCents: number;
  minDepositCents: number;
  turnoverMultiplier: number;
  bonus: number;
  eligible: boolean;
  reason?: string;
}

/**
 * One bonus option.
 *
 * A radio rather than a dropdown: the turnover a bonus carries is the thing a
 * trader most needs to see before choosing, and a dropdown hides it.
 */
function BonusChoice({
  selected,
  onSelect,
  title,
  detail,
  disabled,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  detail: string;
  disabled?: boolean;
}) {
  const id = `bonus-${title.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <div
      className={`flex items-start gap-3 rounded-xl border p-3 transition ${
        selected ? 'border-accent bg-accent/10' : 'border-ink-600 hover:border-ink-500'
      } ${disabled ? 'opacity-50' : ''}`}
    >
      <input
        id={id}
        type="radio"
        name="bonus-offer"
        checked={selected}
        disabled={disabled}
        onChange={onSelect}
        className="mt-0.5 h-4 w-4 shrink-0 accent-accent"
      />
      <label htmlFor={id} className={`min-w-0 ${disabled ? '' : 'cursor-pointer'}`}>
        <span className="block text-sm font-semibold">{title}</span>
        <span className="block text-xs text-slate-400">{detail}</span>
      </label>
    </div>
  );
}

export function DepositPanel({ methods, mockChain, deposits, onChanged }: Props) {
  const refreshUser = useAuth((s) => s.refreshUser);
  const [index, setIndex] = useState(0);
  const [amount, setAmount] = useState(100);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [promoCode, setPromoCode] = useState('');
  const [promo, setPromo] = useState<{ bonus: number; description: string } | null>(null);
  const [promoError, setPromoError] = useState('');
  const [offers, setOffers] = useState<BonusOffer[] | null>(null);
  const [offerId, setOfferId] = useState<string | null>(null);
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

  // the offers are quoted against the amount, so they are re-read as it changes
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      api
        .get<{ enabled: boolean; offers: BonusOffer[] }>(`/wallet/bonus-offers?amount=${amount}`)
        .then((data) => {
          if (cancelled) return;
          setOffers(data.enabled ? data.offers : []);
        })
        .catch(() => {
          if (!cancelled) setOffers([]);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [amount]);

  // a choice that stops applying when the amount changes is dropped rather
  // than left selected and silently ignored at credit time
  useEffect(() => {
    if (!offerId) return;
    const chosen = offers?.find((offer) => offer.id === offerId);
    if (offers && (!chosen || !chosen.eligible)) setOfferId(null);
  }, [offers, offerId]);

  if (!method) return <PaymentPanelSkeleton />;

  const checkPromo = async () => {
    const code = promoCode.trim();
    if (!code) {
      setPromo(null);
      setPromoError('');
      return;
    }
    try {
      const { promo: found } = await api.get<{ promo: { bonus: number; description: string } }>(
        `/wallet/promo?code=${encodeURIComponent(code)}&amount=${amount}`,
      );
      setPromo(found);
      setPromoError('');
    } catch (err) {
      setPromo(null);
      setPromoError(err instanceof ApiError ? err.message : 'That code is not valid');
    }
  };

  const cryptoEstimate =
    amount > 0 && method.rate > 0 ? (amount / method.rate).toFixed(method.decimals) : '0';
  const belowMin = amount < method.minDepositUsd;

  // card and e-wallet are a checkout session, not an address to send crypto
  // to, so they go through the provider-framework endpoint instead
  const isSandboxProvider = method.network === 'CARD' || method.network === 'EWALLET';

  const create = async () => {
    setError('');
    setBusy(true);
    try {
      if (isSandboxProvider) {
        await api.post<{ deposit: Deposit }>('/wallet/deposits/provider', {
          methodKey: `${method.network.toLowerCase()}-${method.currency.toLowerCase()}`,
          amount,
          ...(promo && promoCode.trim() ? { promoCode: promoCode.trim() } : {}),
          ...(offerId ? { bonusOfferId: offerId } : {}),
        });
        onChanged();
        toast.info('Sandbox checkout ready', 'Use the button below to simulate paying');
      } else {
        await api.post<{ deposit: Deposit }>('/wallet/deposits', {
          currency: method.currency,
          network: method.network,
          amount,
          ...(promo && promoCode.trim() ? { promoCode: promoCode.trim() } : {}),
          ...(offerId ? { bonusOfferId: offerId } : {}),
        });
        onChanged();
        toast.info('Deposit address ready', `Send exactly the amount shown to complete the deposit`);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the deposit');
    } finally {
      setBusy(false);
    }
  };

  const simulate = async (id: string, provider: string) => {
    try {
      await api.post(`/wallet/deposits/${id}/simulate-payment`);
      onChanged();
      toast.info(
        provider === 'CARD' || provider === 'EWALLET' ? 'Payment confirmed' : 'Payment broadcast',
        provider === 'CARD' || provider === 'EWALLET'
          ? 'The deposit has been credited'
          : 'Waiting for network confirmations',
      );
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
              {pending.promoCode && (
                <p className="mt-1 text-xs text-up">
                  Promo {pending.promoCode} applies when this deposit confirms
                </p>
              )}
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

          {pending.provider === 'CARD' || pending.provider === 'EWALLET' ? (
            // a checkout session, not an address: there is nothing to send
            // money to here, only a sandbox payment to confirm
            <div className="space-y-3">
              <div className="rounded-xl bg-ink-700/60 p-4 text-center">
                <p className="text-xs uppercase tracking-wide text-slate-400">Amount due</p>
                <p className="mt-1 text-2xl font-bold">
                  ${Number(pending.cryptoAmount).toFixed(2)} {pending.currency}
                </p>
                <p className="mt-1 text-xs text-slate-500">via {pending.networkLabel}</p>
              </div>
              <p className="text-[11px] leading-relaxed text-slate-500">
                There is no real processor behind this yet — real credentials are the owner's to add. The
                button below stands in for the customer completing payment on the provider's own page.
              </p>
              {pending.status === 'AWAITING_PAYMENT' && (
                <button
                  onClick={() => void simulate(pending.id, pending.provider)}
                  className="btn-primary w-full"
                >
                  Simulate successful payment
                </button>
              )}
            </div>
          ) : (
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
                  Send only {pending.currency} over {pending.networkLabel} to this address. Funds are credited
                  after {pending.requiredConf} network confirmations.
                </p>
                {pending.txHash && (
                  <p className="text-[11px] text-slate-400">
                    Transaction <span className="font-mono">{shortHash(pending.txHash, 10)}</span>
                  </p>
                )}
                {mockChain && pending.status === 'AWAITING_PAYMENT' && (
                  <button
                    onClick={() => void simulate(pending.id, pending.provider)}
                    className="btn-ghost w-full text-xs"
                  >
                    Simulate the incoming payment (demo mode)
                  </button>
                )}
              </div>
            </div>
          )}
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
                i === index
                  ? 'border-accent bg-accent-soft'
                  : 'border-ink-600 bg-ink-800 hover:border-ink-500'
              }`}
            >
              <MethodIcon currency={m.currency} network={m.network} />
              <span className="min-w-0">
                <span className="block text-sm font-semibold">{m.currency}</span>
                <span className="block text-[11px] text-slate-400">{m.label}</span>
              </span>
              <span className="ml-auto text-right text-[11px] text-slate-500">
                {m.maxDepositUsd > 0
                  ? `$${m.minDepositUsd.toLocaleString()}–$${m.maxDepositUsd.toLocaleString()}`
                  : `min $${m.minDepositUsd}`}
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

      {offers && offers.length > 0 && (
        <fieldset>
          <legend className="label">Deposit bonus</legend>
          <div className="space-y-2">
            <BonusChoice
              selected={offerId === null}
              onSelect={() => setOfferId(null)}
              title="No bonus"
              detail="Everything you deposit is yours to withdraw whenever you like."
            />
            {offers.map((offer) => (
              <BonusChoice
                key={offer.id}
                selected={offerId === offer.id}
                onSelect={() => setOfferId(offer.id)}
                disabled={!offer.eligible}
                title={offer.name}
                detail={
                  offer.eligible
                    ? `${money(offer.bonus)} extra · stake ${money(offer.bonus * offer.turnoverMultiplier)} to release it`
                    : (offer.reason ?? 'Not available on this amount')
                }
              />
            ))}
          </div>
        </fieldset>
      )}

      <div>
        <label className="label" htmlFor="promo-code">
          Promo code <span className="normal-case text-slate-500">(optional)</span>
        </label>
        <div className="flex items-center gap-2">
          <input
            id="promo-code"
            value={promoCode}
            onChange={(e) => {
              setPromoCode(e.target.value.toUpperCase());
              setPromo(null);
              setPromoError('');
            }}
            onBlur={() => void checkPromo()}
            className="field font-mono !text-xs uppercase"
            placeholder="WELCOME30"
          />
          <button onClick={() => void checkPromo()} className="btn-ghost shrink-0 text-xs">
            Apply
          </button>
        </div>
        {promo && (
          <p className="mt-1.5 rounded-lg bg-up-soft px-3 py-2 text-xs text-up">
            {promo.description} — {money(promo.bonus)} bonus on this deposit
          </p>
        )}
        {promoError && <p className="mt-1.5 text-xs text-down">{promoError}</p>}
      </div>

      {belowMin && (
        <p className="rounded-lg bg-down-soft px-3 py-2 text-xs text-down">
          Minimum deposit on {method.label} is ${method.minDepositUsd}.
        </p>
      )}
      {error && <p className="rounded-lg bg-down-soft px-3 py-2 text-xs text-down">{error}</p>}

      <button onClick={() => void create()} disabled={busy || belowMin} className="btn-primary w-full !py-3">
        {busy ? 'Creating…' : isSandboxProvider ? 'Continue to sandbox checkout' : 'Get deposit address'}
      </button>
    </div>
  );
}
