import { useEffect, useRef, useState } from 'react';
import { ApiError, api } from '../lib/api';
import { dateTime } from '../lib/format';
import { realtime } from '../lib/ws';
import { toast } from '../store/toast';
import type { SupportTicket } from '../lib/types';

/**
 * Floating support desk. One thread per question, replies arrive over the
 * socket, and the launcher carries an unread badge.
 */
export function SupportChat() {
  const [open, setOpen] = useState(false);
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [subject, setSubject] = useState('');
  const [composing, setComposing] = useState(false);
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    try {
      const { tickets: list } = await api.get<{ tickets: SupportTicket[]; unread: number }>('/support/tickets');
      setTickets(list);
      setActiveId((current) => current ?? list[0]?.id ?? null);
      setComposing(list.length === 0);
    } catch {
      /* the widget stays quiet if support is unreachable */
    }
  };

  useEffect(() => {
    void load();
  }, []);

  // live replies land straight in the open thread
  useEffect(() => {
    return realtime.on('support:message', ({ message }) => {
      setTickets((current) =>
        current.map((ticket) =>
          ticket.id === message.ticketId
            ? {
                ...ticket,
                messages: ticket.messages.some((m) => m.id === message.id)
                  ? ticket.messages
                  : [...ticket.messages, message],
                unreadByUser: message.fromSupport && !open ? ticket.unreadByUser + 1 : ticket.unreadByUser,
                lastMessageAt: message.createdAt,
              }
            : ticket,
        ),
      );
      if (message.fromSupport && !open) toast.info('Support replied', message.body.slice(0, 80));
    });
  }, [open]);

  const active = tickets.find((ticket) => ticket.id === activeId) ?? null;
  const unread = tickets.reduce((sum, ticket) => sum + ticket.unreadByUser, 0);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [active?.messages.length, open]);

  // opening a thread clears its badge server-side
  useEffect(() => {
    if (!open || !activeId) return;
    api
      .get<{ ticket: SupportTicket }>(`/support/tickets/${activeId}`)
      .then(({ ticket }) => {
        setTickets((current) => current.map((t) => (t.id === ticket.id ? { ...ticket, unreadByUser: 0 } : t)));
      })
      .catch(() => undefined);
  }, [open, activeId]);

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft.trim() || busy) return;
    setBusy(true);
    try {
      if (composing || !active) {
        const { ticket } = await api.post<{ ticket: SupportTicket }>('/support/tickets', {
          subject: subject.trim() || draft.trim().slice(0, 60),
          message: draft.trim(),
        });
        setTickets((current) => [ticket, ...current]);
        setActiveId(ticket.id);
        setComposing(false);
        setSubject('');
      } else {
        const { message } = await api.post<{ message: SupportTicket['messages'][number] }>(
          `/support/tickets/${active.id}/messages`,
          { message: draft.trim() },
        );
        setTickets((current) =>
          current.map((ticket) =>
            ticket.id === active.id ? { ...ticket, messages: [...ticket.messages, message] } : ticket,
          ),
        );
      }
      setDraft('');
    } catch (err) {
      toast.error('Message not sent', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Support chat"
        className="fixed bottom-24 right-4 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-accent text-white shadow-xl transition hover:brightness-110 md:bottom-6"
      >
        {open ? (
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M21 12a8 8 0 1 1-3.2-6.4" strokeLinecap="round" />
            <path d="M7.5 10h9M7.5 14h5.5" strokeLinecap="round" />
          </svg>
        )}
        {unread > 0 && !open && (
          <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-down px-1 text-[10px] font-bold">
            {unread}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed bottom-40 right-4 z-40 flex h-[26rem] w-[min(22rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-ink-500 bg-ink-800 shadow-2xl md:bottom-20">
          <header className="flex items-center gap-2 border-b border-ink-600 px-3 py-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent-soft text-[10px] font-bold text-accent">
              QX
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">Support</p>
              <p className="text-[10px] text-slate-500">
                {active && !composing ? active.subject : 'Ask us anything about your account'}
              </p>
            </div>
            {tickets.length > 0 && (
              <button
                onClick={() => {
                  setComposing((v) => !v);
                  setDraft('');
                }}
                className="rounded-md px-2 py-1 text-[11px] text-slate-400 transition hover:bg-ink-700 hover:text-slate-200"
              >
                {composing ? 'Back' : 'New'}
              </button>
            )}
          </header>

          {!composing && tickets.length > 1 && (
            <div className="flex gap-1 overflow-x-auto border-b border-ink-600 p-1.5">
              {tickets.map((ticket) => (
                <button
                  key={ticket.id}
                  onClick={() => setActiveId(ticket.id)}
                  className={`shrink-0 rounded-md px-2 py-1 text-[11px] transition ${
                    ticket.id === activeId ? 'bg-ink-600 text-white' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {ticket.subject.slice(0, 18)}
                  {ticket.unreadByUser > 0 && <span className="ml-1 text-down">●</span>}
                </button>
              ))}
            </div>
          )}

          <div className="flex-1 space-y-2 overflow-y-auto p-3">
            {composing || !active ? (
              <p className="rounded-lg bg-ink-700/60 p-3 text-xs leading-relaxed text-slate-400">
                Tell us what you need — deposits, withdrawals, verification or trading. An agent replies right here.
              </p>
            ) : (
              active.messages.map((message) => (
                <div
                  key={message.id}
                  className={`max-w-[85%] rounded-xl px-3 py-2 text-xs leading-relaxed ${
                    message.fromSupport
                      ? 'bg-ink-700 text-slate-200'
                      : 'ml-auto bg-accent text-white'
                  }`}
                >
                  <p className="whitespace-pre-wrap break-words">{message.body}</p>
                  <p className={`mt-1 text-[9px] ${message.fromSupport ? 'text-slate-500' : 'text-white/70'}`}>
                    {message.fromSupport ? 'Support · ' : ''}
                    {dateTime(message.createdAt)}
                  </p>
                </div>
              ))
            )}
            <div ref={endRef} />
          </div>

          <form onSubmit={send} className="space-y-2 border-t border-ink-600 p-2">
            {composing && (
              <input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Subject (optional)"
                className="field !py-2 !text-xs"
              />
            )}
            <div className="flex items-end gap-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void send(e as unknown as React.FormEvent);
                  }
                }}
                rows={2}
                placeholder="Write a message…"
                className="field max-h-24 flex-1 resize-none !py-2 !text-xs"
              />
              <button type="submit" disabled={busy || !draft.trim()} className="btn-primary !px-3 !py-2 text-xs">
                Send
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
