import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ApiError, api } from '../../lib/api';
import { dateTime, money } from '../../lib/format';
import { realtime } from '../../lib/ws';
import { toast } from '../../store/toast';
import { Empty, PageHead, StatusPill } from '../../components/admin/ui';
import { FilterChip, Pager } from '../../components/admin/DataTable';
import { parseTableState, tableStateToParams } from '../../lib/table-query';
import type { SupportTicket } from '../../lib/types';
import { RowSkeletons, Skeleton, SkeletonGroup } from '../../components/Skeleton';

const PAGE_SIZE = 20;

const STATUS_FILTER = {
  key: 'status',
  label: 'Status',
  type: 'enum' as const,
  options: [
    { value: 'OPEN', label: 'Open' },
    { value: 'ANSWERED', label: 'Answered' },
    { value: 'CLOSED', label: 'Closed' },
  ],
};

interface TicketPage {
  tickets: SupportTicket[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

/** Support desk: conversation list on the left, thread and reply box on the right. */
export function AdminSupport() {
  const [params, setParams] = useSearchParams();
  const state = parseTableState(params, PAGE_SIZE);
  const update = (patch: Partial<typeof state>) => {
    setParams(tableStateToParams({ ...state, ...patch }), { replace: true });
  };

  const [searchInput, setSearchInput] = useState(state.search ?? '');
  const [result, setResult] = useState<TicketPage | null>(null);
  const [error, setError] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const filtersKey = JSON.stringify(state.filters);

  const load = useCallback(async () => {
    setError('');
    try {
      const query = tableStateToParams(state);
      const data = await api.get<TicketPage>(`/admin/support?${query.toString()}`);
      setResult(data);
      setActiveId((current) =>
        current && data.tickets.some((t) => t.id === current) ? current : (data.tickets[0]?.id ?? null),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load conversations');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.page, state.pageSize, state.search, filtersKey]);

  useEffect(() => {
    void load();
    const off = realtime.on('support:incoming', () => void load());
    return off;
  }, [load]);

  // the search box debounces locally; every other control updates the URL immediately
  useEffect(() => {
    const id = window.setTimeout(() => {
      if (searchInput !== (state.search ?? '')) update({ search: searchInput || undefined, page: 1 });
    }, 300);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeId, result]);

  const tickets = result?.tickets ?? null;
  const active = tickets?.find((t) => t.id === activeId) ?? null;

  const open = async (id: string) => {
    setActiveId(id);
    try {
      const { ticket } = await api.get<{ ticket: SupportTicket }>(`/admin/support/${id}`);
      setResult((current) =>
        current
          ? {
              ...current,
              tickets: current.tickets.map((t) => (t.id === id ? { ...t, ...ticket, unreadByAgent: 0 } : t)),
            }
          : current,
      );
    } catch {
      /* the list already has enough to show */
    }
  };

  const reply = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!active || !draft.trim()) return;
    setBusy(true);
    try {
      await api.post(`/admin/support/${active.id}/reply`, { message: draft.trim() });
      setDraft('');
      await load();
      await open(active.id);
    } catch (err) {
      toast.error('Reply failed', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (status: 'OPEN' | 'CLOSED') => {
    if (!active) return;
    try {
      await api.post(`/admin/support/${active.id}/status`, { status });
      await load();
      toast.success(status === 'CLOSED' ? 'Conversation closed' : 'Conversation reopened');
    } catch (err) {
      toast.error('Could not update', err instanceof ApiError ? err.message : undefined);
    }
  };

  if (error) {
    return (
      <>
        <PageHead title="Support desk" subtitle="Conversation list and replies" />
        <div className="card flex flex-col items-center gap-2 p-10 text-center">
          <p className="text-xs text-slate-400">{error}</p>
          <button onClick={() => void load()} className="btn-ghost text-xs">
            Retry
          </button>
        </div>
      </>
    );
  }

  if (!result) {
    return (
      <>
        <div className="mb-5 space-y-2">
          <Skeleton className="h-5 w-36" />
          <Skeleton className="h-2.5 w-56 max-w-full" />
        </div>
        <div className="grid gap-3 lg:grid-cols-[20rem_1fr]">
          <RowSkeletons rows={6} className="card p-1.5" rowClassName="p-2.5" />
          <SkeletonGroup className="card hidden space-y-3 p-4 lg:block">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-12 w-3/5" />
            <Skeleton className="ml-auto h-10 w-1/2" />
            <Skeleton className="h-16 w-2/3" />
            <Skeleton className="mt-6 h-14 w-full !rounded-lg" />
          </SkeletonGroup>
        </div>
      </>
    );
  }

  const waiting = (tickets ?? []).filter((t) => t.unreadByAgent > 0).length;

  return (
    <>
      <PageHead
        title="Support desk"
        subtitle={`${result.total} conversations · ${waiting} waiting on this page`}
        action={
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search subject or trader"
            className="field !w-56 !py-2 !text-xs"
          />
        }
      />

      <div className="mb-3 flex flex-wrap gap-2">
        <FilterChip
          filter={STATUS_FILTER}
          value={state.filters.status}
          onChange={(value) => update({ page: 1, filters: { ...state.filters, status: value } })}
        />
        {Object.keys(state.filters).length > 0 && (
          <button
            onClick={() => update({ page: 1, filters: {} })}
            className="chip bg-ink-700 text-slate-400 hover:text-slate-200"
          >
            Clear filters ✕
          </button>
        )}
      </div>

      {result.tickets.length === 0 ? (
        <Empty text="No conversations match" />
      ) : (
        <div className="grid min-w-0 gap-3 lg:grid-cols-[20rem_1fr]">
          <div className="min-w-0">
            <div className="card max-h-[32rem] overflow-y-auto p-1.5">
              {result.tickets.map((ticket) => (
                <button
                  key={ticket.id}
                  onClick={() => void open(ticket.id)}
                  className={`mb-1 w-full rounded-lg p-2.5 text-left transition ${
                    ticket.id === activeId ? 'bg-accent-soft' : 'hover:bg-ink-700'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-xs font-semibold">{ticket.subject}</span>
                    {ticket.unreadByAgent > 0 && (
                      <span className="rounded-full bg-down px-1.5 text-[10px] font-bold text-white">
                        {ticket.unreadByAgent}
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] text-slate-500">
                    {ticket.user?.email}
                  </span>
                  <span className="mt-1 flex items-center gap-2">
                    <StatusPill status={ticket.status} />
                    <span className="text-[10px] text-slate-500">{dateTime(ticket.lastMessageAt)}</span>
                  </span>
                </button>
              ))}
            </div>
            <Pager
              page={result.page}
              pageCount={result.pageCount}
              pageSize={result.pageSize}
              pageSizeOptions={[10, 20, 50, 100]}
              onPage={(p) => update({ page: p })}
              onPageSize={(size) => update({ page: 1, pageSize: size })}
            />
          </div>

          {active && (
            <div className="card flex min-w-0 max-h-[32rem] flex-col">
              <header className="flex items-center gap-3 border-b border-ink-600 p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{active.subject}</p>
                  <p className="truncate text-[11px] text-slate-500">
                    {active.user?.name} · {active.user?.email} · balance{' '}
                    {money(active.user?.realBalance ?? 0)}
                  </p>
                </div>
                <button
                  onClick={() => void setStatus(active.status === 'CLOSED' ? 'OPEN' : 'CLOSED')}
                  className="btn-ghost !px-3 !py-1.5 text-xs"
                >
                  {active.status === 'CLOSED' ? 'Reopen' : 'Close'}
                </button>
              </header>

              <div className="min-w-0 flex-1 space-y-2 overflow-y-auto p-3">
                {active.messages.map((message) => (
                  <div
                    key={message.id}
                    className={`max-w-[80%] rounded-xl px-3 py-2 text-xs leading-relaxed ${
                      message.fromSupport ? 'ml-auto bg-accent text-white' : 'bg-ink-700 text-slate-200'
                    }`}
                  >
                    <p className="whitespace-pre-wrap break-words">{message.body}</p>
                    <p
                      className={`mt-1 text-[9px] ${message.fromSupport ? 'text-white/70' : 'text-slate-500'}`}
                    >
                      {message.fromSupport ? 'You' : active.user?.name} · {dateTime(message.createdAt)}
                    </p>
                  </div>
                ))}
                <div ref={endRef} />
              </div>

              <form onSubmit={reply} className="flex items-end gap-2 border-t border-ink-600 p-2">
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void reply(e as unknown as React.FormEvent);
                    }
                  }}
                  rows={2}
                  placeholder="Reply to the trader…"
                  className="field max-h-28 flex-1 resize-none !py-2 !text-xs"
                />
                <button
                  type="submit"
                  disabled={busy || !draft.trim()}
                  className="btn-primary !px-4 !py-2 text-xs"
                >
                  Send
                </button>
              </form>
            </div>
          )}
        </div>
      )}
    </>
  );
}
