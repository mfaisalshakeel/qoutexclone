import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../../lib/api';
import { money } from '../../lib/format';
import { toast } from '../../store/toast';
import { Empty, Loading, PageHead, StatusPill, Table, Td } from '../../components/admin/ui';

interface AdminPaymentMethod {
  id: string;
  provider: string;
  key: string;
  label: string;
  currency: string;
  network: string | null;
  enabled: boolean;
  feePct: number;
  feeFlatCents: number;
  minDepositCents: number;
  maxDepositCents: number;
  minWithdrawCents: number;
  maxWithdrawCents: number;
  countries: string[] | null;
  sortOrder: number;
}

/** cents both ways: "$1.00" in the field, an integer cents value on the wire. */
const centsToDollars = (cents: number) => (cents / 100).toString();
const dollarsToCents = (dollars: string) => Math.round(Number(dollars) * 100);

/**
 * The methods behind the provider framework: what a trader is offered, at
 * what fee, inside what limits, and in which countries. The provider each
 * row belongs to (crypto network, card gateway, e-wallet) is fixed at
 * creation and not editable here — only the operator-facing half is.
 */
export function AdminPaymentMethods() {
  const [methods, setMethods] = useState<AdminPaymentMethod[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<AdminPaymentMethod | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await api.get<{ methods: AdminPaymentMethod[] }>('/admin/payment-methods');
      setMethods(data.methods);
      setOpen((current) => (current ? (data.methods.find((m) => m.id === current.id) ?? null) : null));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load payment methods');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleEnabled = async (method: AdminPaymentMethod) => {
    try {
      await api.patch(`/admin/payment-methods/${method.id}`, { enabled: !method.enabled });
      toast.success(`${method.label} ${method.enabled ? 'disabled' : 'enabled'}`);
      void load();
    } catch (err) {
      toast.error('Could not update it', err instanceof ApiError ? err.message : undefined);
    }
  };

  if (error) {
    return (
      <div className="card p-6 text-center">
        <p className="text-sm text-slate-300">{error}</p>
        <button onClick={() => void load()} className="btn-primary mt-4">
          Try again
        </button>
      </div>
    );
  }

  return (
    <div>
      <PageHead
        title="Payment methods"
        subtitle="Fees, limits and which countries each deposit/withdrawal method is offered in."
      />

      {!methods && <Loading rows={6} cols={5} />}
      {methods && methods.length === 0 && <Empty text="No payment methods." />}
      {methods && methods.length > 0 && (
        <Table head={['Method', 'Fee', 'Deposit limits', 'Withdraw limits', 'State']}>
          {methods.map((method) => (
            <tr key={method.id} className="transition hover:bg-ink-700/40">
              <Td>
                <button onClick={() => setOpen(method)} className="text-left hover:text-accent">
                  <span className="block text-sm font-semibold">{method.label}</span>
                  <span className="block text-[11px] text-slate-500">
                    {method.currency}
                    {method.network ? ` · ${method.network}` : ''} · {method.provider.toLowerCase()}
                  </span>
                </button>
              </Td>
              <Td className="tabular text-xs text-slate-300">
                {method.feePct > 0 && `${method.feePct}%`}
                {method.feePct > 0 && method.feeFlatCents > 0 && ' + '}
                {method.feeFlatCents > 0 && money(method.feeFlatCents)}
                {method.feePct === 0 && method.feeFlatCents === 0 && 'None'}
              </Td>
              <Td className="tabular text-xs text-slate-400">
                {money(method.minDepositCents)} – {method.maxDepositCents > 0 ? money(method.maxDepositCents) : 'no cap'}
              </Td>
              <Td className="tabular text-xs text-slate-400">
                {money(method.minWithdrawCents)} –{' '}
                {method.maxWithdrawCents > 0 ? money(method.maxWithdrawCents) : 'no cap'}
              </Td>
              <Td>
                <button onClick={() => void toggleEnabled(method)} className="inline-flex">
                  <StatusPill status={method.enabled ? 'active' : 'closed'} />
                </button>
              </Td>
            </tr>
          ))}
        </Table>
      )}

      {open && <MethodDrawer method={open} onClose={() => setOpen(null)} onSaved={load} />}
    </div>
  );
}

function MethodDrawer({
  method,
  onClose,
  onSaved,
}: {
  method: AdminPaymentMethod;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    label: method.label,
    enabled: method.enabled,
    feePct: String(method.feePct),
    feeFlat: centsToDollars(method.feeFlatCents),
    minDeposit: centsToDollars(method.minDepositCents),
    maxDeposit: centsToDollars(method.maxDepositCents),
    minWithdraw: centsToDollars(method.minWithdrawCents),
    maxWithdraw: centsToDollars(method.maxWithdrawCents),
    countries: (method.countries ?? []).join(', '),
    sortOrder: String(method.sortOrder),
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const save = async () => {
    setBusy(true);
    try {
      await api.patch(`/admin/payment-methods/${method.id}`, {
        label: form.label,
        enabled: form.enabled,
        feePct: Number(form.feePct),
        feeFlatCents: dollarsToCents(form.feeFlat),
        minDepositCents: dollarsToCents(form.minDeposit),
        maxDepositCents: dollarsToCents(form.maxDeposit),
        minWithdrawCents: dollarsToCents(form.minWithdraw),
        maxWithdrawCents: dollarsToCents(form.maxWithdraw),
        countries: form.countries
          .split(',')
          .map((code) => code.trim().toUpperCase())
          .filter(Boolean),
        sortOrder: Number(form.sortOrder),
      });
      toast.success('Saved');
      onSaved();
      onClose();
    } catch (err) {
      toast.error('Could not save', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex">
      <button aria-label="Close" onClick={onClose} className="flex-1 bg-black/60" />
      <aside
        role="dialog"
        aria-label="Edit payment method"
        className="flex w-full max-w-lg flex-col overflow-y-auto border-l border-ink-600 bg-ink-800"
      >
        <header className="flex items-start justify-between gap-3 border-b border-ink-600 p-4">
          <div>
            <p className="text-sm font-semibold">{method.label}</p>
            <p className="text-[11px] text-slate-500">
              {method.currency}
              {method.network ? ` · ${method.network}` : ''} · {method.provider.toLowerCase()} — identity fields,
              not editable here
            </p>
          </div>
          <button onClick={onClose} className="btn-ghost !py-1.5">
            Close ✕
          </button>
        </header>

        <div className="grid gap-3 p-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="label" htmlFor="pm-label">
              Label
            </label>
            <input
              id="pm-label"
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
              className="field"
            />
          </div>
          <div className="flex items-center gap-2 sm:col-span-2">
            <input
              id="pm-enabled"
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
              className="h-4 w-4"
            />
            <label htmlFor="pm-enabled" className="text-sm text-slate-300">
              Offered to traders
            </label>
          </div>
          <div>
            <label className="label" htmlFor="pm-fee-pct">
              Fee %
            </label>
            <input
              id="pm-fee-pct"
              type="number"
              min={0}
              step="0.1"
              value={form.feePct}
              onChange={(e) => setForm({ ...form, feePct: e.target.value })}
              className="field"
            />
          </div>
          <div>
            <label className="label" htmlFor="pm-fee-flat">
              Flat fee $
            </label>
            <input
              id="pm-fee-flat"
              type="number"
              min={0}
              step="0.01"
              value={form.feeFlat}
              onChange={(e) => setForm({ ...form, feeFlat: e.target.value })}
              className="field"
            />
          </div>
          <div>
            <label className="label" htmlFor="pm-min-deposit">
              Min deposit $
            </label>
            <input
              id="pm-min-deposit"
              type="number"
              min={0}
              step="0.01"
              value={form.minDeposit}
              onChange={(e) => setForm({ ...form, minDeposit: e.target.value })}
              className="field"
            />
          </div>
          <div>
            <label className="label" htmlFor="pm-max-deposit">
              Max deposit $ (0 = no cap)
            </label>
            <input
              id="pm-max-deposit"
              type="number"
              min={0}
              step="0.01"
              value={form.maxDeposit}
              onChange={(e) => setForm({ ...form, maxDeposit: e.target.value })}
              className="field"
            />
          </div>
          <div>
            <label className="label" htmlFor="pm-min-withdraw">
              Min withdraw $
            </label>
            <input
              id="pm-min-withdraw"
              type="number"
              min={0}
              step="0.01"
              value={form.minWithdraw}
              onChange={(e) => setForm({ ...form, minWithdraw: e.target.value })}
              className="field"
            />
          </div>
          <div>
            <label className="label" htmlFor="pm-max-withdraw">
              Max withdraw $ (0 = no cap)
            </label>
            <input
              id="pm-max-withdraw"
              type="number"
              min={0}
              step="0.01"
              value={form.maxWithdraw}
              onChange={(e) => setForm({ ...form, maxWithdraw: e.target.value })}
              className="field"
            />
          </div>
          <div>
            <label className="label" htmlFor="pm-sort">
              Sort order
            </label>
            <input
              id="pm-sort"
              type="number"
              min={0}
              value={form.sortOrder}
              onChange={(e) => setForm({ ...form, sortOrder: e.target.value })}
              className="field"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="pm-countries">
              Countries (ISO codes, comma-separated — empty means every country)
            </label>
            <input
              id="pm-countries"
              value={form.countries}
              onChange={(e) => setForm({ ...form, countries: e.target.value })}
              className="field"
              placeholder="US, GB, DE"
            />
          </div>
        </div>

        <div className="flex gap-2 p-4 pt-0">
          <button onClick={() => void save()} disabled={busy} className="btn-primary flex-1">
            {busy ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </aside>
    </div>
  );
}
