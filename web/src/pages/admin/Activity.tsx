import { api } from '../../lib/api';
import { dateTime, money } from '../../lib/format';
import { StatusPill } from '../../components/admin/ui';
import { DataTable, type DataTableColumn } from '../../components/admin/DataTable';
import type { AccountType, Trade, Transaction } from '../../lib/types';

interface AdminTrade extends Trade {
  user: { email: string; name: string };
}

const TRADE_FILTERS = [
  {
    key: 'status',
    label: 'Status',
    type: 'enum' as const,
    options: [
      { value: 'OPEN', label: 'Open' },
      { value: 'WON', label: 'Won' },
      { value: 'LOST', label: 'Lost' },
      { value: 'REFUNDED', label: 'Refunded' },
    ],
  },
  {
    key: 'accountType',
    label: 'Account',
    type: 'enum' as const,
    options: [
      { value: 'DEMO', label: 'Demo' },
      { value: 'REAL', label: 'Real' },
      { value: 'TOURNAMENT', label: 'Tournament' },
    ],
  },
  {
    key: 'direction',
    label: 'Direction',
    type: 'enum' as const,
    options: [
      { value: 'UP', label: 'Higher' },
      { value: 'DOWN', label: 'Lower' },
    ],
  },
  { key: 'openedAt', label: 'Opened', type: 'dateRange' as const },
];

/** Every position across every trader — for support, and for a shape check on the settlement path. */
export function AdminTrades() {
  const columns: DataTableColumn<AdminTrade>[] = [
    {
      key: 'user',
      label: 'Trader',
      render: (t) => (
        <>
          <span className="block text-xs font-semibold">{t.user.name}</span>
          <span className="block text-[11px] text-slate-500">{t.user.email}</span>
        </>
      ),
    },
    {
      key: 'symbol',
      label: 'Market',
      render: (t) => (
        <>
          <span className="block text-xs font-semibold">
            {t.symbol}
            <span className={`ml-2 ${t.direction === 'UP' ? 'text-up' : 'text-down'}`}>
              {t.direction === 'UP' ? '▲' : '▼'}
            </span>
          </span>
          <span className="chip mt-1 bg-ink-700 text-slate-400">{t.accountType.toLowerCase()}</span>
        </>
      ),
    },
    {
      key: 'stake',
      label: 'Stake',
      sortable: true,
      render: (t) => (
        <>
          <span className="tabular block text-xs font-semibold">{money(t.stake)}</span>
          <span className="tabular block text-[11px] text-slate-500">{t.payoutPct}% payout</span>
        </>
      ),
    },
    {
      key: 'profit',
      label: 'Result',
      sortable: true,
      render: (t) => (
        <>
          <StatusPill status={t.status} />
          {t.status !== 'OPEN' && (
            <span className={`tabular mt-1 block text-[11px] ${t.profit >= 0 ? 'text-up' : 'text-down'}`}>
              {money(t.profit, { sign: true })}
            </span>
          )}
        </>
      ),
    },
    {
      key: 'openedAt',
      label: 'Opened',
      sortable: true,
      align: 'right',
      render: (t) => (
        <>
          <span className="block text-[11px] text-slate-500">{dateTime(t.openedAt)}</span>
          {t.settledAt && (
            <span className="block text-[10px] text-slate-500">settled {dateTime(t.settledAt)}</span>
          )}
        </>
      ),
    },
  ];

  return (
    <DataTable<AdminTrade>
      title="Trades"
      columns={columns}
      filters={TRADE_FILTERS}
      searchPlaceholder="Search trader or symbol"
      rowKey={(t) => t.id}
      fetchPage={async (state) => {
        const params = new URLSearchParams({ page: String(state.page), pageSize: String(state.pageSize) });
        if (state.sort) params.set('sort', state.sort);
        if (state.search) params.set('search', state.search);
        for (const [key, value] of Object.entries(state.filters)) params.set(key, value);
        const data = await api.get<{ trades: AdminTrade[]; total: number; pageCount: number }>(
          `/admin/trades?${params.toString()}`,
        );
        return { items: data.trades, total: data.total, pageCount: data.pageCount };
      }}
      exportPath={(params) => `/admin/trades/export?${params.toString()}`}
    />
  );
}

interface AdminTransaction extends Transaction {
  user: { email: string; name: string };
}

// every literal `applyLedger` writes as a transaction type — kept in step
// with `TX_TYPES` in server/src/services/wallet.ts
const LEDGER_TYPES = [
  'DEPOSIT',
  'WITHDRAWAL_HOLD',
  'WITHDRAWAL_REFUND',
  'TRADE_STAKE',
  'TRADE_PAYOUT',
  'TRADE_REFUND',
  'BONUS',
  'REFERRAL_COMMISSION',
  'TOURNAMENT_ENTRY',
  'TOURNAMENT_PRIZE',
  'ADJUSTMENT',
  'DEMO_RESET',
  'MARKETPLACE',
  'RISK_FREE_REFUND',
  'PRACTICE_TOPUP',
];

const LEDGER_FILTERS = [
  {
    key: 'type',
    label: 'Type',
    type: 'enum' as const,
    options: LEDGER_TYPES.map((value) => ({ value, label: value.replace(/_/g, ' ').toLowerCase() })),
  },
  {
    key: 'accountType',
    label: 'Account',
    type: 'enum' as const,
    options: [
      { value: 'DEMO', label: 'Demo' },
      { value: 'REAL', label: 'Real' },
    ],
  },
  { key: 'createdAt', label: 'When', type: 'dateRange' as const },
];

/** Every balance-changing entry, across every account — the one thing `applyLedger` ever writes. */
export function AdminLedger() {
  const columns: DataTableColumn<AdminTransaction>[] = [
    {
      key: 'user',
      label: 'Trader',
      render: (tx) => (
        <>
          <span className="block text-xs font-semibold">{tx.user.name}</span>
          <span className="block text-[11px] text-slate-500">{tx.user.email}</span>
        </>
      ),
    },
    {
      key: 'type',
      label: 'Type',
      render: (tx) => (
        <>
          <span className="font-mono text-[11px] text-accent">{tx.type}</span>
          <span className="chip mt-1 bg-ink-700 text-slate-400">
            {(tx.accountType as AccountType).toLowerCase()}
          </span>
        </>
      ),
    },
    {
      key: 'amount',
      label: 'Amount',
      sortable: true,
      render: (tx) => (
        <>
          <span className={`tabular block text-xs font-semibold ${tx.amount >= 0 ? 'text-up' : 'text-down'}`}>
            {money(tx.amount, { sign: true })}
          </span>
          <span className="tabular block text-[11px] text-slate-500">balance {money(tx.balanceAfter)}</span>
        </>
      ),
    },
    {
      key: 'note',
      label: 'Note',
      render: (tx) => <span className="text-[11px] text-slate-400">{tx.note ?? '—'}</span>,
    },
    {
      key: 'createdAt',
      label: 'When',
      sortable: true,
      align: 'right',
      render: (tx) => <span className="text-[11px] text-slate-500">{dateTime(tx.createdAt)}</span>,
    },
  ];

  return (
    <DataTable<AdminTransaction>
      title="Ledger"
      columns={columns}
      filters={LEDGER_FILTERS}
      searchPlaceholder="Search trader, note or reference"
      rowKey={(tx) => tx.id}
      fetchPage={async (state) => {
        const params = new URLSearchParams({ page: String(state.page), pageSize: String(state.pageSize) });
        if (state.sort) params.set('sort', state.sort);
        if (state.search) params.set('search', state.search);
        for (const [key, value] of Object.entries(state.filters)) params.set(key, value);
        const data = await api.get<{ transactions: AdminTransaction[]; total: number; pageCount: number }>(
          `/admin/transactions?${params.toString()}`,
        );
        return { items: data.transactions, total: data.total, pageCount: data.pageCount };
      }}
      exportPath={(params) => `/admin/transactions/export?${params.toString()}`}
    />
  );
}

interface ReferralCommissionRow {
  id: string;
  amount: number;
  rate: number;
  createdAt: string;
  referrer: { email: string; name: string };
  referred: { email: string; name: string };
}

const REFERRAL_FILTERS = [{ key: 'createdAt', label: 'When', type: 'dateRange' as const }];

/** Every commission a referral has ever paid out, referrer and referred trader side by side. */
export function AdminReferrals() {
  const columns: DataTableColumn<ReferralCommissionRow>[] = [
    {
      key: 'referrer',
      label: 'Referrer',
      render: (row) => (
        <>
          <span className="block text-xs font-semibold">{row.referrer.name}</span>
          <span className="block text-[11px] text-slate-500">{row.referrer.email}</span>
        </>
      ),
    },
    {
      key: 'referred',
      label: 'Referred trader',
      render: (row) => (
        <>
          <span className="block text-xs font-semibold">{row.referred.name}</span>
          <span className="block text-[11px] text-slate-500">{row.referred.email}</span>
        </>
      ),
    },
    {
      key: 'amount',
      label: 'Commission',
      sortable: true,
      render: (row) => (
        <>
          <span className="tabular block text-xs font-semibold text-up">{money(row.amount)}</span>
          <span className="tabular block text-[11px] text-slate-500">{(row.rate * 100).toFixed(1)}%</span>
        </>
      ),
    },
    {
      key: 'createdAt',
      label: 'When',
      sortable: true,
      align: 'right',
      render: (row) => <span className="text-[11px] text-slate-500">{dateTime(row.createdAt)}</span>,
    },
  ];

  return (
    <DataTable<ReferralCommissionRow>
      title="Referrals"
      columns={columns}
      filters={REFERRAL_FILTERS}
      searchPlaceholder="Search by trader email or name"
      rowKey={(row) => row.id}
      fetchPage={async (state) => {
        const params = new URLSearchParams({ page: String(state.page), pageSize: String(state.pageSize) });
        if (state.sort) params.set('sort', state.sort);
        if (state.search) params.set('search', state.search);
        for (const [key, value] of Object.entries(state.filters)) params.set(key, value);
        const data = await api.get<{
          commissions: ReferralCommissionRow[];
          total: number;
          pageCount: number;
        }>(`/admin/referrals?${params.toString()}`);
        return { items: data.commissions, total: data.total, pageCount: data.pageCount };
      }}
      exportPath={(params) => `/admin/referrals/export?${params.toString()}`}
    />
  );
}
