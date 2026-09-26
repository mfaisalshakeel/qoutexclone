import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../../lib/api';
import { dateTime } from '../../lib/format';
import { toast } from '../../store/toast';
import { Empty, Loading, PageHead, StatusPill, Table, Td } from '../../components/admin/ui';
import type { EmailTemplateOverride } from '../../lib/types';

interface OutboxRow {
  id: string;
  to: string;
  subject: string;
  template: string;
  transport: string;
  status: 'QUEUED' | 'SENT' | 'FAILED';
  error: string | null;
  sentAt: string | null;
  createdAt: string;
}

interface TemplatePreview {
  id: string;
  label: string;
  when: string;
  email: { subject: string; html: string; text: string };
}

const STATUSES = ['', 'SENT', 'FAILED', 'QUEUED'] as const;

/**
 * Email in the back office: what went out, what it looked like, and whether
 * the SMTP settings actually deliver.
 */
export function AdminEmail() {
  const [tab, setTab] = useState<'outbox' | 'templates'>('outbox');

  return (
    <div>
      <PageHead
        title="Email"
        subtitle="Every message the platform composed, the templates behind them, and a way to prove the server works."
      />

      <div role="tablist" aria-label="Email sections" className="mb-4 flex gap-1">
        {(['outbox', 'templates'] as const).map((key) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
              tab === key ? 'bg-ink-600 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {key === 'outbox' ? 'Outbox' : 'Templates'}
          </button>
        ))}
      </div>

      {tab === 'outbox' ? <Outbox /> : <Templates />}
    </div>
  );
}

function TestSend() {
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await api.post<{
        status: string;
        error?: string;
        transport: string;
        configured: boolean;
      }>('/admin/emails/test', { to });
      if (result.status === 'SENT' && result.configured) {
        toast.success('Test email sent', `Delivered through ${result.transport}.`);
      } else if (!result.configured) {
        toast.error('No SMTP server configured', 'The message is in the outbox but was not delivered.');
      } else {
        toast.error('The server refused it', result.error);
      }
    } catch (err) {
      toast.error('Could not send it', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={send} className="card mb-4 flex flex-wrap items-end gap-3 p-4">
      <div className="min-w-[220px] flex-1">
        <label className="label" htmlFor="test-to">
          Send a test email to
        </label>
        <input
          id="test-to"
          type="email"
          required
          value={to}
          onChange={(event) => setTo(event.target.value)}
          className="field"
          placeholder="you@example.com"
        />
      </div>
      <button type="submit" disabled={busy} className="btn-primary">
        {busy ? 'Sending…' : 'Send test email'}
      </button>
    </form>
  );
}

function Outbox() {
  const [rows, setRows] = useState<OutboxRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState<string>('');
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<(OutboxRow & { html: string; text: string }) | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const params = new URLSearchParams({ pageSize: '50' });
      if (status) params.set('status', status);
      if (search) params.set('search', search);
      const data = await api.get<{ emails: OutboxRow[]; total: number }>(`/admin/emails?${params}`);
      setRows(data.emails);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the outbox');
    }
  }, [status, search]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [load, search]);

  const preview = async (id: string) => {
    try {
      const { email } = await api.get<{ email: OutboxRow & { html: string; text: string } }>(
        `/admin/emails/${id}`,
      );
      setOpen(email);
    } catch (err) {
      toast.error('Could not open it', err instanceof ApiError ? err.message : undefined);
    }
  };

  return (
    <>
      <TestSend />

      <div className="mb-3 flex flex-wrap gap-2">
        <input
          aria-label="Search by recipient"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="field max-w-xs"
          placeholder="Search by recipient"
        />
        <div role="group" aria-label="Delivery status" className="flex gap-1">
          {STATUSES.map((value) => (
            <button
              key={value || 'all'}
              onClick={() => setStatus(value)}
              aria-pressed={status === value}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                status === value ? 'bg-ink-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {value || 'All'}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="card p-6 text-center">
          <p className="text-sm text-slate-300">{error}</p>
          <button onClick={() => void load()} className="btn-primary mt-4">
            Try again
          </button>
        </div>
      )}

      {!error && rows === null && <Loading rows={6} cols={5} />}

      {!error && rows !== null && rows.length === 0 && <Empty text="No messages match that." />}

      {!error && rows !== null && rows.length > 0 && (
        <>
          <p className="mb-2 text-xs text-slate-500">
            {total} message{total === 1 ? '' : 's'}
          </p>
          <Table head={['Recipient', 'Subject', 'Template', 'Status', 'When']}>
            {rows.map((row) => (
              <tr key={row.id} className="transition hover:bg-ink-700/40">
                <Td>
                  <button onClick={() => void preview(row.id)} className="text-left hover:text-accent">
                    {row.to}
                  </button>
                </Td>
                <Td className="text-slate-300">{row.subject}</Td>
                <Td className="text-xs text-slate-400">{row.template}</Td>
                <Td>
                  <StatusPill status={row.status} />
                  {row.error && <p className="mt-1 max-w-[18rem] text-[11px] text-down">{row.error}</p>}
                </Td>
                <Td className="text-right text-xs text-slate-400">{dateTime(row.createdAt)}</Td>
              </tr>
            ))}
          </Table>
        </>
      )}

      {open && <PreviewDrawer title={open.subject} html={open.html} onClose={() => setOpen(null)} />}
    </>
  );
}

function Templates() {
  const [templates, setTemplates] = useState<TemplatePreview[] | null>(null);
  const [overrides, setOverrides] = useState<Map<string, EmailTemplateOverride> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<TemplatePreview | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [previews, overridesData] = await Promise.all([
        api.get<{ templates: TemplatePreview[] }>('/admin/email-templates'),
        api.get<{ overrides: EmailTemplateOverride[] }>('/admin/email-templates/overrides'),
      ]);
      setTemplates(previews.templates);
      setOverrides(new Map(overridesData.overrides.map((o) => [o.key, o])));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the templates');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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

  if (!templates || !overrides) return <Loading rows={4} cols={3} />;

  return (
    <>
      <p className="mb-3 text-xs text-slate-500">
        The layout, buttons and any amount or status a message reports are fixed. What you can change here is
        the subject line and its intro sentence — the copy, not the structure.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {templates.map((template) => {
          const override = overrides.get(template.id);
          const customized = Boolean(override?.publishedSubject || override?.publishedBody);
          return (
            <button
              key={template.id}
              onClick={() => setOpen(template)}
              className="card p-4 text-left transition hover:border-ink-400"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold">{template.label}</p>
                {customized && <StatusPill status="active" />}
              </div>
              <p className="mt-0.5 text-xs text-slate-400">{template.when}</p>
              <p className="mt-2 truncate text-xs text-slate-500">
                {override?.publishedSubject || template.email.subject}
              </p>
            </button>
          );
        })}
      </div>
      {open && overrides.get(open.id) && (
        <EmailTemplateDrawer
          template={open}
          override={overrides.get(open.id)!}
          onClose={() => setOpen(null)}
          onSaved={load}
        />
      )}
    </>
  );
}

/**
 * A template's rendered preview alongside its CMS override: subject and intro
 * copy, with placeholders the underlying template fills in. Publishing takes
 * effect at once — the next message this template sends uses it.
 */
function EmailTemplateDrawer({
  template,
  override,
  onClose,
  onSaved,
}: {
  template: TemplatePreview;
  override: EmailTemplateOverride;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [subject, setSubject] = useState(override.draftSubject ?? '');
  const [body, setBody] = useState(override.draftBody ?? '');
  const [busy, setBusy] = useState<'save' | 'publish' | 'revert' | null>(null);
  const isCustomized = Boolean(override.publishedSubject || override.publishedBody);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const save = async () => {
    setBusy('save');
    try {
      await api.put(`/admin/email-templates/overrides/${template.id}`, {
        subject: subject || null,
        body: body || null,
      });
      toast.success('Draft saved');
      onSaved();
    } catch (err) {
      toast.error('Could not save', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(null);
    }
  };

  const publish = async () => {
    setBusy('publish');
    try {
      await api.put(`/admin/email-templates/overrides/${template.id}`, {
        subject: subject || null,
        body: body || null,
      });
      await api.post(`/admin/email-templates/overrides/${template.id}/publish`);
      toast.success('Template published');
      onSaved();
    } catch (err) {
      toast.error('Could not publish', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(null);
    }
  };

  const revert = async () => {
    setBusy('revert');
    try {
      await api.post(`/admin/email-templates/overrides/${template.id}/unpublish`);
      toast.success('Reverted to the default copy');
      onSaved();
    } catch (err) {
      toast.error('Could not revert it', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex">
      <button aria-label="Close" onClick={onClose} className="flex-1 bg-black/60" />
      <aside
        role="dialog"
        aria-label="Email preview"
        className="flex w-full max-w-2xl flex-col overflow-y-auto border-l border-ink-600 bg-ink-800"
      >
        <header className="flex items-start justify-between gap-3 border-b border-ink-600 p-4">
          <p className="text-sm font-semibold">{template.label}</p>
          <button onClick={onClose} className="btn-ghost !py-1.5">
            Close
          </button>
        </header>

        <iframe title="Email preview" srcDoc={template.email.html} sandbox="" className="h-72 bg-white" />

        <div className="space-y-3 p-4">
          <p className="text-xs text-slate-500">
            Placeholders: {override.placeholders.map((p) => `{{${p}}}`).join(', ')}
          </p>
          <div>
            <label className="label" htmlFor="et-subject">
              Subject override
            </label>
            <input
              id="et-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="field"
              placeholder={template.email.subject}
            />
          </div>
          <div>
            <label className="label" htmlFor="et-body">
              Intro sentence override
            </label>
            <textarea
              id="et-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={3}
              className="field"
              placeholder="Leave blank to keep the platform default"
            />
          </div>
          {isCustomized && (
            <p className="text-[11px] text-accent">This template is live with custom copy.</p>
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            <button onClick={() => void save()} disabled={busy !== null} className="btn-ghost">
              {busy === 'save' ? 'Saving…' : 'Save draft'}
            </button>
            <button onClick={() => void publish()} disabled={busy !== null} className="btn-primary">
              {busy === 'publish' ? 'Publishing…' : 'Publish'}
            </button>
            {isCustomized && (
              <button onClick={() => void revert()} disabled={busy !== null} className="btn-ghost !text-down">
                {busy === 'revert' ? 'Reverting…' : 'Revert to default'}
              </button>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}

/**
 * The message as a mail client would draw it.
 *
 * Rendered in a sandboxed iframe rather than into the page: email HTML is
 * table soup with its own styles, and none of it belongs in the back office's
 * own document.
 */
function PreviewDrawer({ title, html, onClose }: { title: string; html: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex">
      <button aria-label="Close the preview" onClick={onClose} className="flex-1 bg-black/60" />
      <aside
        role="dialog"
        aria-label="Email preview"
        className="flex w-full max-w-xl flex-col border-l border-ink-600 bg-ink-800"
      >
        <header className="flex items-start gap-3 border-b border-ink-600 p-4">
          <div className="min-w-0 flex-1">
            <p className="text-xs uppercase tracking-wide text-slate-500">Subject</p>
            <p className="truncate text-sm font-semibold">{title}</p>
          </div>
          <button onClick={onClose} className="btn-ghost !py-1.5">
            Close
          </button>
        </header>
        <iframe title="Email preview" srcDoc={html} sandbox="" className="flex-1 bg-white" />
      </aside>
    </div>
  );
}
