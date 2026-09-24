import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, api } from '../../lib/api';
import { dateTime, money } from '../../lib/format';
import { toast } from '../../store/toast';
import { Empty, PageHead, StatCard, StatusPill, Table, Td } from '../../components/admin/ui';
import { RowSkeletons, Skeleton, SkeletonGroup, StatSkeletons } from '../../components/Skeleton';
import type { Deposit, Trade, Transaction, User, Withdrawal, SupportTicket } from '../../lib/types';
import type { KycSubmission } from './Traders';

interface SessionRow {
  id: string;
  device: string;
  ip: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string;
  current: boolean;
}

interface BonusRow {
  id: string;
  source: string;
  amount: number;
  required: number;
  staked: number;
  status: string;
  note: string | null;
  createdAt: string;
}

interface ReferredUser {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  totalDeposited: number;
}

interface CommissionRow {
  id: string;
  amount: number;
  rate: number;
  createdAt: string;
  referred: { email: string; name: string };
}

interface NoteRow {
  id: string;
  body: string;
  createdAt: string;
  author: { name: string; email: string };
}

interface AuditRow {
  id: string;
  action: string;
  detail: string | null;
  createdAt: string;
  actor: { name: string; email: string } | null;
}

interface ProfileData {
  user: User;
  trades: Trade[];
  transactions: Transaction[];
  deposits: Deposit[];
  withdrawals: Withdrawal[];
  kyc: KycSubmission | null;
  sessions: SessionRow[];
  bonuses: BonusRow[];
  referrals: { referred: ReferredUser[]; commissions: CommissionRow[] };
  tickets: SupportTicket[];
  notes: NoteRow[];
  auditLog: AuditRow[];
}

const STATUS_LEVELS: { id: 'STANDARD' | 'PRO' | 'VIP'; label: string }[] = [
  { id: 'STANDARD', label: 'Standard' },
  { id: 'PRO', label: 'Pro' },
  { id: 'VIP', label: 'VIP' },
];

async function adjustBalance(user: User, reload: () => void) {
  const raw = window.prompt(`Adjust ${user.email}'s live balance by (USD, negative to debit):`);
  const amount = Number(raw);
  if (!raw || !Number.isFinite(amount) || amount === 0) return;
  const note = window.prompt('Note for the ledger:') ?? undefined;
  try {
    await api.post(`/admin/users/${user.id}/adjust`, { accountType: 'REAL', amount, note });
    reload();
    toast.success(`Balance adjusted by ${money(Math.round(amount * 100), { sign: true })}`);
  } catch (err) {
    toast.error('Adjustment failed', err instanceof ApiError ? err.message : undefined);
  }
}

async function toggleStatus(user: User, reload: () => void) {
  const status = user.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
  try {
    await api.post(`/admin/users/${user.id}/status`, { status });
    reload();
    toast.success(status === 'ACTIVE' ? 'Account reinstated' : 'Account suspended');
  } catch (err) {
    toast.error('Could not update', err instanceof ApiError ? err.message : undefined);
  }
}

async function forceLogout(user: User, reload: () => void) {
  if (!window.confirm(`Sign ${user.name} out of every device?`)) return;
  try {
    const { revoked } = await api.post<{ revoked: number }>(`/admin/users/${user.id}/force-logout`, {});
    reload();
    toast.success(revoked > 0 ? `Signed out of ${revoked} session(s)` : 'No active sessions to sign out');
  } catch (err) {
    toast.error('Could not force logout', err instanceof ApiError ? err.message : undefined);
  }
}

async function resetTwoFactor(user: User, reload: () => void) {
  if (!window.confirm(`Turn off two-factor for ${user.name}? They will be emailed that it changed.`)) return;
  try {
    await api.post(`/admin/users/${user.id}/reset-2fa`, {});
    reload();
    toast.success('Two-factor turned off');
  } catch (err) {
    toast.error('Could not reset two-factor', err instanceof ApiError ? err.message : undefined);
  }
}

/** Full trader profile: everything about one account in one place, reached from the traders list. */
export function AdminUserProfile() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<ProfileData | null>(null);
  const [error, setError] = useState('');
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [sendingEmail, setSendingEmail] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [levelDraft, setLevelDraft] = useState('');
  const [savingLevel, setSavingLevel] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setError('');
    try {
      const result = await api.get<ProfileData>(`/admin/users/${id}`);
      setData(result);
      setLevelDraft(result.user.statusLevelOverride ?? '');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load this trader');
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const sendEmail = async () => {
    if (!id || !emailSubject.trim() || !emailBody.trim()) return;
    setSendingEmail(true);
    try {
      await api.post(`/admin/users/${id}/email`, { subject: emailSubject.trim(), body: emailBody.trim() });
      toast.success('Email sent');
      setEmailOpen(false);
      setEmailSubject('');
      setEmailBody('');
    } catch (err) {
      toast.error('Could not send email', err instanceof ApiError ? err.message : undefined);
    } finally {
      setSendingEmail(false);
    }
  };

  const addNote = async () => {
    if (!id || !noteDraft.trim()) return;
    setSavingNote(true);
    try {
      await api.post(`/admin/users/${id}/notes`, { body: noteDraft.trim() });
      setNoteDraft('');
      await load();
      toast.success('Note added');
    } catch (err) {
      toast.error('Could not add note', err instanceof ApiError ? err.message : undefined);
    } finally {
      setSavingNote(false);
    }
  };

  const saveLevel = async () => {
    if (!id) return;
    setSavingLevel(true);
    try {
      await api.post(`/admin/users/${id}/status-level`, { levelId: levelDraft || null });
      await load();
      toast.success(levelDraft ? `Status pinned to ${levelDraft}` : 'Status pin cleared');
    } catch (err) {
      toast.error('Could not change status level', err instanceof ApiError ? err.message : undefined);
    } finally {
      setSavingLevel(false);
    }
  };

  if (error) {
    return (
      <>
        <PageHead title="Trader profile" />
        <div className="card p-8 text-center">
          <p className="text-sm text-slate-300">{error}</p>
          <Link to="/admin/users" className="btn-ghost mt-3 inline-block text-xs">
            Back to traders
          </Link>
        </div>
      </>
    );
  }

  if (!data) {
    return (
      <>
        <PageHead title="Trader profile" />
        <SkeletonGroup className="space-y-6" label="Loading trader">
          <div className="card space-y-3 p-5">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-56" />
          </div>
          <StatSkeletons count={4} className="grid grid-cols-2 gap-3 sm:grid-cols-4" />
          <div className="card p-2">
            <RowSkeletons rows={5} />
          </div>
        </SkeletonGroup>
      </>
    );
  }

  const { user } = data;

  return (
    <>
      <PageHead
        title={user.name}
        subtitle={user.email}
        action={
          <Link to="/admin/users" className="btn-ghost text-xs">
            ← Back to traders
          </Link>
        }
      />

      <div className="card flex flex-wrap items-center gap-2 p-4">
        <StatusPill status={user.kycStatus} />
        <StatusPill status={user.status} />
        {user.role === 'ADMIN' && <span className="chip bg-accent-soft text-accent">admin</span>}
        {user.statusLevel && <span className="chip bg-ink-600 text-slate-300">{user.statusLevel.name}</span>}
        {user.statusLevelOverride && (
          <span className="chip bg-amber-400/10 text-amber-300">pinned: {user.statusLevelOverride}</span>
        )}
        <span className="text-[11px] text-slate-500">joined {dateTime(user.createdAt)}</span>
        <span className="ml-auto flex flex-wrap gap-2">
          <button onClick={() => void adjustBalance(user, load)} className="btn-ghost !px-3 !py-1.5 text-xs">
            Adjust balance
          </button>
          <button onClick={() => void toggleStatus(user, load)} className="btn-ghost !px-3 !py-1.5 text-xs">
            {user.status === 'ACTIVE' ? 'Suspend' : 'Activate'}
          </button>
          <button onClick={() => void forceLogout(user, load)} className="btn-ghost !px-3 !py-1.5 text-xs">
            Force logout
          </button>
          {user.twoFactorEnabled && (
            <button onClick={() => void resetTwoFactor(user, load)} className="btn-ghost !px-3 !py-1.5 text-xs">
              Reset 2FA
            </button>
          )}
          <button onClick={() => setEmailOpen((v) => !v)} className="btn-ghost !px-3 !py-1.5 text-xs">
            Send email
          </button>
        </span>
      </div>

      {emailOpen && (
        <div className="card mt-3 space-y-3 p-4">
          <p className="text-xs font-semibold text-slate-300">Send an email to {user.email}</p>
          <input
            value={emailSubject}
            onChange={(e) => setEmailSubject(e.target.value)}
            placeholder="Subject"
            className="field w-full text-xs"
          />
          <textarea
            value={emailBody}
            onChange={(e) => setEmailBody(e.target.value)}
            placeholder="Message"
            rows={5}
            className="field w-full text-xs"
          />
          <div className="flex justify-end gap-2">
            <button onClick={() => setEmailOpen(false)} className="btn-ghost !px-3 !py-1.5 text-xs">
              Cancel
            </button>
            <button
              onClick={() => void sendEmail()}
              disabled={sendingEmail || !emailSubject.trim() || !emailBody.trim()}
              className="btn-primary !px-3 !py-1.5 text-xs disabled:opacity-50"
            >
              {sendingEmail ? 'Sending…' : 'Send'}
            </button>
          </div>
        </div>
      )}

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Live balance" value={money(user.realBalance)} hint={user.lockedBalance > 0 ? `${money(user.lockedBalance)} held` : undefined} />
        <StatCard label="Practice balance" value={money(user.demoBalance)} />
        <StatCard label="Deposited" value={money(user.totalDeposited)} />
        <StatCard label="Withdrawn" value={money(user.totalWithdrawn)} />
      </div>

      <h2 className="mb-2 mt-6 text-sm font-semibold">Status level</h2>
      <div className="card flex flex-wrap items-center gap-3 p-4">
        <p className="text-xs text-slate-400">
          Computed from lifetime deposits, unless pinned. Currently{' '}
          <span className="font-semibold text-slate-200">{user.statusLevel?.name ?? '—'}</span>.
        </p>
        <select
          value={levelDraft}
          onChange={(e) => setLevelDraft(e.target.value)}
          className="field ml-auto !w-auto text-xs"
        >
          <option value="">Computed from deposits (no pin)</option>
          {STATUS_LEVELS.map((level) => (
            <option key={level.id} value={level.id}>
              Pin to {level.label}
            </option>
          ))}
        </select>
        <button
          onClick={() => void saveLevel()}
          disabled={savingLevel || levelDraft === (user.statusLevelOverride ?? '')}
          className="btn-ghost !px-3 !py-1.5 text-xs disabled:opacity-50"
        >
          {savingLevel ? 'Saving…' : 'Save'}
        </button>
      </div>

      <h2 className="mb-2 mt-6 text-sm font-semibold">Identity verification</h2>
      {data.kyc ? (
        <div className="card space-y-1 p-4">
          <div className="flex items-center gap-2">
            <StatusPill status={data.kyc.status} />
            <span className="text-xs font-semibold text-slate-200">{data.kyc.fullName}</span>
          </div>
          <p className="text-[11px] text-slate-500">
            {data.kyc.documentType.replace(/_/g, ' ').toLowerCase()} · {data.kyc.documentNumber} ·{' '}
            {data.kyc.country}
          </p>
          <p className="text-[11px] text-slate-500">submitted {dateTime(data.kyc.createdAt)}</p>
          {data.kyc.note && <p className="text-[11px] text-slate-500">note: {data.kyc.note}</p>}
        </div>
      ) : (
        <Empty text="No identity submission yet" />
      )}

      <h2 className="mb-2 mt-6 text-sm font-semibold">Devices and sessions</h2>
      {data.sessions.length === 0 ? (
        <Empty text="No active sessions" />
      ) : (
        <Table head={['Device', 'IP', 'Last used', 'Expires']}>
          {data.sessions.slice(0, 10).map((s) => (
            <tr key={s.id}>
              <Td className="text-xs">{s.device}</Td>
              <Td className="font-mono text-[11px] text-slate-400">{s.ip ?? '—'}</Td>
              <Td className="text-[11px] text-slate-500">{s.lastUsedAt ? dateTime(s.lastUsedAt) : '—'}</Td>
              <Td className="text-right text-[11px] text-slate-500">{dateTime(s.expiresAt)}</Td>
            </tr>
          ))}
        </Table>
      )}
      {data.sessions.length > 10 && (
        <p className="mt-1.5 text-[11px] text-slate-500">
          Showing the 10 most recent of {data.sessions.length} sessions.
        </p>
      )}

      <h2 className="mb-2 mt-6 text-sm font-semibold">Recent trades</h2>
      {data.trades.length === 0 ? (
        <Empty text="No trades yet" />
      ) : (
        <Table head={['Market', 'Account', 'Stake', 'Result', 'When']}>
          {data.trades.map((t) => (
            <tr key={t.id}>
              <Td className="text-xs">
                {t.symbol}
                <span className={`ml-2 ${t.direction === 'UP' ? 'text-up' : 'text-down'}`}>
                  {t.direction === 'UP' ? '▲' : '▼'}
                </span>
              </Td>
              <Td className="text-[11px] text-slate-500">{t.accountType}</Td>
              <Td className="tabular text-xs font-semibold">{money(t.stake)}</Td>
              <Td className="text-right">
                <StatusPill status={t.status} />
                {t.status !== 'OPEN' && (
                  <span className={`tabular ml-2 text-[11px] ${t.profit >= 0 ? 'text-up' : 'text-down'}`}>
                    {money(t.profit, { sign: true })}
                  </span>
                )}
              </Td>
              <Td className="text-[11px] text-slate-500">{dateTime(t.openedAt)}</Td>
            </tr>
          ))}
        </Table>
      )}

      <h2 className="mb-2 mt-6 text-sm font-semibold">Recent deposits</h2>
      {data.deposits.length === 0 ? (
        <Empty text="No deposits yet" />
      ) : (
        <Table head={['Amount', 'Network', 'When', 'Status']}>
          {data.deposits.map((d) => (
            <tr key={d.id}>
              <Td className="tabular text-xs font-semibold">{money(d.creditedAmount)}</Td>
              <Td className="text-[11px] text-slate-400">{d.networkLabel}</Td>
              <Td className="text-[11px] text-slate-500">{dateTime(d.createdAt)}</Td>
              <Td className="text-right">
                <StatusPill status={d.status} />
              </Td>
            </tr>
          ))}
        </Table>
      )}

      <h2 className="mb-2 mt-6 text-sm font-semibold">Recent withdrawals</h2>
      {data.withdrawals.length === 0 ? (
        <Empty text="No withdrawals yet" />
      ) : (
        <Table head={['Amount', 'Destination', 'When', 'Status']}>
          {data.withdrawals.map((w) => (
            <tr key={w.id}>
              <Td className="tabular text-xs font-semibold">{money(w.amount)}</Td>
              <Td className="font-mono text-[11px] text-slate-400">
                {w.cryptoAmount} {w.currency}
                <span className="block text-slate-500">{w.networkLabel}</span>
              </Td>
              <Td className="text-[11px] text-slate-500">{dateTime(w.createdAt)}</Td>
              <Td className="text-right">
                <StatusPill status={w.status} />
              </Td>
            </tr>
          ))}
        </Table>
      )}

      <h2 className="mb-2 mt-6 text-sm font-semibold">Ledger</h2>
      {data.transactions.length === 0 ? (
        <Empty text="No ledger activity yet" />
      ) : (
        <Table head={['Type', 'Account', 'Amount', 'Balance after', 'When']}>
          {data.transactions.map((tx) => (
            <tr key={tx.id}>
              <Td className="text-xs">{tx.type}</Td>
              <Td className="text-[11px] text-slate-500">{tx.accountType}</Td>
              <Td className={`tabular text-xs font-semibold ${tx.amount >= 0 ? 'text-up' : 'text-down'}`}>
                {money(tx.amount, { sign: true })}
              </Td>
              <Td className="tabular text-[11px] text-slate-500">{money(tx.balanceAfter)}</Td>
              <Td className="text-right text-[11px] text-slate-500">{dateTime(tx.createdAt)}</Td>
            </tr>
          ))}
        </Table>
      )}

      <h2 className="mb-2 mt-6 text-sm font-semibold">Bonuses</h2>
      {data.bonuses.length === 0 ? (
        <Empty text="No bonuses yet" />
      ) : (
        <Table head={['Source', 'Amount', 'Turnover', 'Status', 'When']}>
          {data.bonuses.map((b) => (
            <tr key={b.id}>
              <Td className="text-xs">{b.source}</Td>
              <Td className="tabular text-xs font-semibold">{money(b.amount)}</Td>
              <Td className="tabular text-[11px] text-slate-500">
                {money(b.staked)} / {money(b.required)}
              </Td>
              <Td className="text-right">
                <StatusPill status={b.status} />
              </Td>
              <Td className="text-right text-[11px] text-slate-500">{dateTime(b.createdAt)}</Td>
            </tr>
          ))}
        </Table>
      )}

      <h2 className="mb-2 mt-6 text-sm font-semibold">Referrals</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <p className="mb-2 text-[11px] text-slate-500">Traders they brought in</p>
          {data.referrals.referred.length === 0 ? (
            <Empty text="No referrals yet" />
          ) : (
            <Table head={['Trader', 'Deposited', 'Joined']}>
              {data.referrals.referred.map((r) => (
                <tr key={r.id}>
                  <Td className="text-xs">
                    {r.name}
                    <span className="block text-[10px] text-slate-500">{r.email}</span>
                  </Td>
                  <Td className="tabular text-[11px] text-slate-400">{money(r.totalDeposited)}</Td>
                  <Td className="text-right text-[11px] text-slate-500">{dateTime(r.createdAt)}</Td>
                </tr>
              ))}
            </Table>
          )}
        </div>
        <div>
          <p className="mb-2 text-[11px] text-slate-500">Commission earned</p>
          {data.referrals.commissions.length === 0 ? (
            <Empty text="No commissions yet" />
          ) : (
            <Table head={['From', 'Amount', 'When']}>
              {data.referrals.commissions.map((c) => (
                <tr key={c.id}>
                  <Td className="text-xs">{c.referred.name}</Td>
                  <Td className="tabular text-[11px] text-slate-400">{money(c.amount)}</Td>
                  <Td className="text-right text-[11px] text-slate-500">{dateTime(c.createdAt)}</Td>
                </tr>
              ))}
            </Table>
          )}
        </div>
      </div>

      <h2 className="mb-2 mt-6 text-sm font-semibold">Support tickets</h2>
      {data.tickets.length === 0 ? (
        <Empty text="No tickets yet" />
      ) : (
        <Table head={['Subject', 'Status', 'Last message']}>
          {data.tickets.map((t) => (
            <tr key={t.id}>
              <Td className="text-xs">{t.subject}</Td>
              <Td>
                <StatusPill status={t.status} />
              </Td>
              <Td className="text-right text-[11px] text-slate-500">{dateTime(t.lastMessageAt)}</Td>
            </tr>
          ))}
        </Table>
      )}

      <h2 className="mb-2 mt-6 text-sm font-semibold">Notes</h2>
      <div className="card space-y-3 p-4">
        <textarea
          value={noteDraft}
          onChange={(e) => setNoteDraft(e.target.value)}
          placeholder="Add a note for the next admin who opens this account…"
          rows={3}
          className="field w-full text-xs"
        />
        <div className="flex justify-end">
          <button
            onClick={() => void addNote()}
            disabled={savingNote || !noteDraft.trim()}
            className="btn-ghost !px-3 !py-1.5 text-xs disabled:opacity-50"
          >
            {savingNote ? 'Saving…' : 'Add note'}
          </button>
        </div>
        {data.notes.length === 0 ? (
          <p className="text-[11px] text-slate-500">No notes yet.</p>
        ) : (
          <div className="space-y-2 border-t border-ink-700 pt-3">
            {data.notes.map((n) => (
              <div key={n.id} className="text-xs">
                <p className="text-slate-300">{n.body}</p>
                <p className="mt-0.5 text-[10px] text-slate-500">
                  {n.author.name} · {dateTime(n.createdAt)}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      <h2 className="mb-2 mt-6 text-sm font-semibold">Audit trail</h2>
      {data.auditLog.length === 0 ? (
        <Empty text="No admin actions on this account yet" />
      ) : (
        <Table head={['Action', 'By', 'Detail', 'When']}>
          {data.auditLog.map((a) => (
            <tr key={a.id}>
              <Td className="text-xs">{a.action}</Td>
              <Td className="text-[11px] text-slate-500">{a.actor?.email ?? 'system'}</Td>
              <Td className="text-[11px] text-slate-500">{a.detail ?? '—'}</Td>
              <Td className="text-right text-[11px] text-slate-500">{dateTime(a.createdAt)}</Td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}
