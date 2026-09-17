import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../../lib/api';
import { dateTime, money, shortHash } from '../../lib/format';
import { toast } from '../../store/toast';
import { Empty, Loading, PageHead, StatusPill, Table, Td } from '../../components/admin/ui';
import type { Deposit, Withdrawal } from '../../lib/types';

const FILTERS = ['ALL', 'PENDING', 'COMPLETED', 'REJECTED'] as const;

export function AdminWithdrawals() {
  const [rows, setRows] = useState<Withdrawal[] | null>(null);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('ALL');

  const load = useCallback(async () => {
    const { withdrawals } = await api.get<{ withdrawals: Withdrawal[] }>('/admin/withdrawals');
    setRows(withdrawals);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (id: string, action: 'approve' | 'reject') => {
    const note =
      action === 'reject'
        ? window.prompt('Reason for rejection? The trader sees this.')
        : 'Approved from back office';
    if (action === 'reject' && !note) return;
    try {
      await api.post(`/admin/withdrawals/${id}/${action}`, { note });
      await load();
      toast.success(action === 'approve' ? 'Payout sent' : 'Withdrawal rejected, funds returned');
    } catch (err) {
      toast.error('Action failed', err instanceof ApiError ? err.message : undefined);
    }
  };

  if (!rows) return <Loading />;
  const visible = filter === 'ALL' ? rows : rows.filter((r) => r.status === filter);
  const pendingTotal = rows.filter((r) => r.status === 'PENDING').reduce((sum, r) => sum + r.amount, 0);

  return (
    <>
      <PageHead
        title="Withdrawals"
        subtitle={`${rows.filter((r) => r.status === 'PENDING').length} awaiting review · ${money(pendingTotal)} held`}
        action={<Filters value={filter} onChange={setFilter} />}
      />

      {visible.length === 0 ? (
        <Empty text="Nothing here" />
      ) : (
        <Table head={['Trader', 'Amount', 'Destination', 'Requested', 'Status', 'Action']}>
          {visible.map((w) => (
            <tr key={w.id}>
              <Td>
                <span className="block text-xs font-semibold">{w.user?.name ?? '—'}</span>
                <span className="block text-[11px] text-slate-500">{w.user?.email}</span>
                <span className="block text-[11px] text-slate-500">
                  deposited {money(w.user?.totalDeposited ?? 0)}
                </span>
              </Td>
              <Td>
                <span className="tabular block text-xs font-semibold">{money(w.amount)}</span>
                <span className="tabular block text-[11px] text-slate-500">fee {money(w.fee)}</span>
              </Td>
              <Td>
                <span className="block text-xs">
                  {w.cryptoAmount} {w.currency}
                </span>
                <span className="block font-mono text-[10px] text-slate-500">{w.address}</span>
                <span className="block text-[10px] text-slate-500">{w.networkLabel}</span>
                {w.txHash && (
                  <span className="block font-mono text-[10px] text-accent">{shortHash(w.txHash)}</span>
                )}
              </Td>
              <Td className="text-[11px] text-slate-500">{dateTime(w.createdAt)}</Td>
              <Td>
                <StatusPill status={w.status} />
                {w.adminNote && <span className="mt-1 block text-[10px] text-slate-500">{w.adminNote}</span>}
              </Td>
              <Td className="text-right">
                {w.status === 'PENDING' ? (
                  <span className="flex justify-end gap-2">
                    <button
                      onClick={() => void act(w.id, 'approve')}
                      className="btn-up !px-3 !py-1.5 text-xs"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => void act(w.id, 'reject')}
                      className="btn-ghost !px-3 !py-1.5 text-xs !text-down"
                    >
                      Reject
                    </button>
                  </span>
                ) : (
                  <span className="text-[11px] text-slate-500">
                    {w.processedAt ? dateTime(w.processedAt) : '—'}
                  </span>
                )}
              </Td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}

export function AdminDeposits() {
  const [rows, setRows] = useState<Deposit[] | null>(null);
  const [filter, setFilter] = useState<'ALL' | 'PENDING' | 'COMPLETED' | 'REJECTED'>('ALL');

  const load = useCallback(async () => {
    const { deposits } = await api.get<{ deposits: Deposit[] }>('/admin/deposits');
    setRows(deposits);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (id: string, action: 'confirm' | 'reject') => {
    const note = action === 'reject' ? window.prompt('Why is this deposit being rejected?') : undefined;
    if (action === 'reject' && !note) return;
    try {
      await api.post(`/admin/deposits/${id}/${action}`, note ? { note } : {});
      await load();
      toast.success(action === 'confirm' ? 'Deposit credited' : 'Deposit rejected');
    } catch (err) {
      toast.error('Action failed', err instanceof ApiError ? err.message : undefined);
    }
  };

  if (!rows) return <Loading />;
  const pending = rows.filter((d) => d.status === 'AWAITING_PAYMENT' || d.status === 'CONFIRMING');
  const visible =
    filter === 'ALL' ? rows : filter === 'PENDING' ? pending : rows.filter((d) => d.status === filter);

  return (
    <>
      <PageHead
        title="Deposits"
        subtitle={`${pending.length} awaiting confirmation`}
        action={<Filters value={filter} onChange={setFilter} />}
      />

      {visible.length === 0 ? (
        <Empty text="Nothing here" />
      ) : (
        <Table head={['Trader', 'Amount', 'Address', 'Created', 'Status', 'Action']}>
          {visible.map((d) => (
            <tr key={d.id}>
              <Td>
                <span className="block text-xs font-semibold">{d.user?.name ?? '—'}</span>
                <span className="block text-[11px] text-slate-500">{d.user?.email}</span>
              </Td>
              <Td>
                <span className="block text-xs font-semibold">
                  {d.cryptoAmount} {d.currency}
                </span>
                {d.creditedAmount > 0 && (
                  <span className="tabular block text-[11px] text-up">
                    credited {money(d.creditedAmount)}
                  </span>
                )}
                {d.bonusAmount > 0 && (
                  <span className="tabular block text-[11px] text-up">bonus {money(d.bonusAmount)}</span>
                )}
                {d.promoCode && (
                  <span className="block font-mono text-[10px] text-slate-500">{d.promoCode}</span>
                )}
              </Td>
              <Td>
                <span className="block font-mono text-[10px] text-slate-500">{d.address}</span>
                <span className="block text-[10px] text-slate-500">
                  {d.networkLabel} · {d.confirmations}/{d.requiredConf} conf
                </span>
                {d.txHash && (
                  <span className="block font-mono text-[10px] text-accent">{shortHash(d.txHash)}</span>
                )}
              </Td>
              <Td className="text-[11px] text-slate-500">{dateTime(d.createdAt)}</Td>
              <Td>
                <StatusPill status={d.status} />
              </Td>
              <Td className="text-right">
                {d.status === 'AWAITING_PAYMENT' || d.status === 'CONFIRMING' ? (
                  <span className="flex justify-end gap-2">
                    <button
                      onClick={() => void act(d.id, 'confirm')}
                      className="btn-up !px-3 !py-1.5 text-xs"
                    >
                      Credit
                    </button>
                    <button
                      onClick={() => void act(d.id, 'reject')}
                      className="btn-ghost !px-3 !py-1.5 text-xs !text-down"
                    >
                      Reject
                    </button>
                  </span>
                ) : (
                  <span className="text-[11px] text-slate-500">
                    {d.confirmedAt ? dateTime(d.confirmedAt) : '—'}
                  </span>
                )}
              </Td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}

function Filters<T extends string>({ value, onChange }: { value: T; onChange: (value: T) => void }) {
  return (
    <div className="flex gap-1 rounded-lg border border-ink-600 bg-ink-800 p-1">
      {(FILTERS as readonly string[]).map((option) => (
        <button
          key={option}
          onClick={() => onChange(option as T)}
          className={`rounded-md px-2.5 py-1.5 text-[11px] font-semibold capitalize transition ${
            value === option ? 'bg-ink-600 text-white' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          {option.toLowerCase()}
        </button>
      ))}
    </div>
  );
}
