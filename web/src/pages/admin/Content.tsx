import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../../lib/api';
import { dateTime } from '../../lib/format';
import { toast } from '../../store/toast';
import { Empty, Loading, PageHead, StatusPill, Table, Td } from '../../components/admin/ui';
import { MarkdownEditor } from '../../components/admin/MarkdownEditor';
import type { Announcement, AnnouncementStyle, FaqEntry, HomepageSection, LegalPage } from '../../lib/types';

const TABS = ['homepage', 'faq', 'legal', 'announcements'] as const;
type Tab = (typeof TABS)[number];
const TAB_LABEL: Record<Tab, string> = {
  homepage: 'Homepage',
  faq: 'FAQ',
  legal: 'Legal pages',
  announcements: 'Announcements',
};

/**
 * The content CMS: the homepage's own sections, the help-centre FAQ, the
 * fixed legal documents, and the platform-wide announcement banner. Long-form
 * copy (homepage, legal) keeps a draft separate from what is published;
 * short items (FAQ, announcements) publish by a visibility flag — see
 * `content.ts` on the server for why.
 */
export function AdminContent() {
  const [tab, setTab] = useState<Tab>('homepage');

  return (
    <div>
      <PageHead
        title="Content"
        subtitle="Homepage copy, the help-centre FAQ, legal pages and the platform-wide announcement banner."
      />

      <div role="tablist" aria-label="Content sections" className="mb-4 flex flex-wrap gap-1">
        {TABS.map((key) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
              tab === key ? 'bg-ink-600 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {TAB_LABEL[key]}
          </button>
        ))}
      </div>

      {tab === 'homepage' && <HomepageTab />}
      {tab === 'faq' && <FaqTab />}
      {tab === 'legal' && <LegalTab />}
      {tab === 'announcements' && <AnnouncementsTab />}
    </div>
  );
}

/** Slide-over used by every tab below, so editing one content type reads the same as any other. */
function Drawer({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex">
      <button aria-label="Close" onClick={onClose} className="flex-1 bg-black/60" />
      <aside
        role="dialog"
        aria-label={title}
        className="flex w-full max-w-xl flex-col overflow-y-auto border-l border-ink-600 bg-ink-800"
      >
        <header className="flex items-start justify-between gap-3 border-b border-ink-600 p-4">
          <p className="text-sm font-semibold">{title}</p>
          <button onClick={onClose} className="btn-ghost !py-1.5">
            Close ✕
          </button>
        </header>
        <div className="flex-1 space-y-4 p-4">{children}</div>
      </aside>
    </div>
  );
}

function PublishBadge({ publishedAt, hasDraftAhead }: { publishedAt: string | null; hasDraftAhead: boolean }) {
  if (!publishedAt) return <StatusPill status="draft" />;
  return <StatusPill status={hasDraftAhead ? 'pending' : 'active'} />;
}

/* --------------------------------- homepage -------------------------------- */

function HomepageTab() {
  const [sections, setSections] = useState<HomepageSection[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<HomepageSection | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await api.get<{ sections: HomepageSection[] }>('/admin/content/homepage');
      setSections(data.sections);
      setOpen((current) => (current ? (data.sections.find((s) => s.key === current.key) ?? null) : null));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the homepage sections');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <ErrorCard message={error} onRetry={load} />;
  if (!sections) return <Loading rows={6} cols={3} />;
  if (sections.length === 0) return <Empty text="No homepage sections." />;

  return (
    <>
      <p className="mb-3 text-xs text-slate-500">
        The fixed list Phase 7's homepage renders, in order. Publish a section once its copy is ready — a
        draft never reaches the live site on its own.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {sections.map((section) => (
          <button
            key={section.key}
            onClick={() => setOpen(section)}
            className="card p-4 text-left transition hover:border-ink-400"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold">{section.label}</p>
              <PublishBadge
                publishedAt={section.publishedAt}
                hasDraftAhead={section.draftTitle !== section.publishedTitle || section.draftBody !== section.publishedBody}
              />
            </div>
            <p className="mt-1.5 truncate text-xs text-slate-400">
              {section.draftTitle || section.publishedTitle || 'No title yet'}
            </p>
          </button>
        ))}
      </div>
      {open && <HomepageSectionDrawer section={open} onClose={() => setOpen(null)} onSaved={load} />}
    </>
  );
}

function HomepageSectionDrawer({
  section,
  onClose,
  onSaved,
}: {
  section: HomepageSection;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(section.draftTitle ?? '');
  const [subtitle, setSubtitle] = useState(section.draftSubtitle ?? '');
  const [body, setBody] = useState(section.draftBody ?? '');
  const [busy, setBusy] = useState<'save' | 'publish' | null>(null);

  const save = async () => {
    setBusy('save');
    try {
      await api.put(`/admin/content/homepage/${section.key}`, { title, subtitle, body });
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
      await save();
      await api.post(`/admin/content/homepage/${section.key}/publish`);
      toast.success('Section published');
      onSaved();
    } catch (err) {
      toast.error('Could not publish', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Drawer title={section.label} onClose={onClose}>
      <div>
        <label className="label" htmlFor="hs-title">
          Title
        </label>
        <input id="hs-title" value={title} onChange={(e) => setTitle(e.target.value)} className="field" />
      </div>
      <div>
        <label className="label" htmlFor="hs-subtitle">
          Subtitle
        </label>
        <input
          id="hs-subtitle"
          value={subtitle}
          onChange={(e) => setSubtitle(e.target.value)}
          className="field"
        />
      </div>
      <MarkdownEditor id="hs-body" label="Body" value={body} onChange={setBody} rows={8} />
      {section.publishedAt && (
        <p className="text-[11px] text-slate-500">Last published {dateTime(section.publishedAt)}.</p>
      )}
      <div className="flex gap-2 pt-2">
        <button onClick={() => void save()} disabled={busy !== null} className="btn-ghost flex-1">
          {busy === 'save' ? 'Saving…' : 'Save draft'}
        </button>
        <button onClick={() => void publish()} disabled={busy !== null} className="btn-primary flex-1">
          {busy === 'publish' ? 'Publishing…' : 'Publish'}
        </button>
      </div>
    </Drawer>
  );
}

/* ----------------------------------- FAQ ------------------------------------ */

function FaqTab() {
  const [entries, setEntries] = useState<FaqEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<FaqEntry | null>(null);
  const [form, setForm] = useState({ category: '', question: '', answer: '', sortOrder: 0 });

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await api.get<{ entries: FaqEntry[] }>('/admin/content/faq');
      setEntries(data.entries);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the FAQ');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      await api.post('/admin/content/faq', { ...form, published: false });
      setForm({ category: '', question: '', answer: '', sortOrder: 0 });
      toast.success('Question added as a draft');
      void load();
    } catch (err) {
      toast.error('Could not add it', err instanceof ApiError ? err.message : undefined);
    }
  };

  const togglePublished = async (entry: FaqEntry) => {
    try {
      await api.patch(`/admin/content/faq/${entry.id}`, { published: !entry.published });
      void load();
    } catch (err) {
      toast.error('Could not update it', err instanceof ApiError ? err.message : undefined);
    }
  };

  if (error) return <ErrorCard message={error} onRetry={load} />;

  return (
    <>
      <form onSubmit={create} className="card mb-4 grid gap-3 p-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="faq-category">
            Category
          </label>
          <input
            id="faq-category"
            required
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
            className="field"
            placeholder="Deposits"
          />
        </div>
        <div>
          <label className="label" htmlFor="faq-sort">
            Order
          </label>
          <input
            id="faq-sort"
            type="number"
            value={form.sortOrder}
            onChange={(e) => setForm({ ...form, sortOrder: Number(e.target.value) })}
            className="field"
          />
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="faq-question">
            Question
          </label>
          <input
            id="faq-question"
            required
            value={form.question}
            onChange={(e) => setForm({ ...form, question: e.target.value })}
            className="field"
            placeholder="How long does a deposit take?"
          />
        </div>
        <div className="sm:col-span-2">
          <MarkdownEditor
            id="faq-answer"
            label="Answer"
            value={form.answer}
            onChange={(answer) => setForm({ ...form, answer })}
            rows={4}
          />
        </div>
        <div className="sm:col-span-2">
          <button type="submit" className="btn-primary">
            Add question
          </button>
        </div>
      </form>

      {!error && entries === null && <Loading rows={5} cols={4} />}
      {!error && entries !== null && entries.length === 0 && <Empty text="No FAQ entries yet." />}
      {!error && entries !== null && entries.length > 0 && (
        <Table head={['Category', 'Question', 'State', 'Action']}>
          {entries.map((entry) => (
            <tr key={entry.id} className="transition hover:bg-ink-700/40">
              <Td className="text-xs text-slate-400">{entry.category}</Td>
              <Td>
                <button onClick={() => setOpen(entry)} className="text-left text-sm hover:text-accent">
                  {entry.question}
                </button>
              </Td>
              <Td>
                <StatusPill status={entry.published ? 'active' : 'draft'} />
              </Td>
              <Td className="text-right">
                <button
                  onClick={() => void togglePublished(entry)}
                  className="btn-ghost !px-3 !py-1.5 text-xs"
                >
                  {entry.published ? 'Unpublish' : 'Publish'}
                </button>
              </Td>
            </tr>
          ))}
        </Table>
      )}

      {open && <FaqEntryDrawer entry={open} onClose={() => setOpen(null)} onSaved={load} />}
    </>
  );
}

function FaqEntryDrawer({
  entry,
  onClose,
  onSaved,
}: {
  entry: FaqEntry;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [category, setCategory] = useState(entry.category);
  const [question, setQuestion] = useState(entry.question);
  const [answer, setAnswer] = useState(entry.answer);
  const [sortOrder, setSortOrder] = useState(entry.sortOrder);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await api.patch(`/admin/content/faq/${entry.id}`, { category, question, answer, sortOrder });
      toast.success('Saved');
      onSaved();
      onClose();
    } catch (err) {
      toast.error('Could not save', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!deleting) {
      setDeleting(true);
      return;
    }
    try {
      await api.del(`/admin/content/faq/${entry.id}`);
      toast.success('Deleted');
      onSaved();
      onClose();
    } catch (err) {
      toast.error('Could not delete it', err instanceof ApiError ? err.message : undefined);
    }
  };

  return (
    <Drawer title="Edit question" onClose={onClose}>
      <div>
        <label className="label" htmlFor="faq-e-category">
          Category
        </label>
        <input
          id="faq-e-category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="field"
        />
      </div>
      <div>
        <label className="label" htmlFor="faq-e-question">
          Question
        </label>
        <input
          id="faq-e-question"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          className="field"
        />
      </div>
      <MarkdownEditor id="faq-e-answer" label="Answer" value={answer} onChange={setAnswer} rows={5} />
      <div>
        <label className="label" htmlFor="faq-e-sort">
          Order
        </label>
        <input
          id="faq-e-sort"
          type="number"
          value={sortOrder}
          onChange={(e) => setSortOrder(Number(e.target.value))}
          className="field"
        />
      </div>
      <div className="flex gap-2 pt-2">
        <button
          onClick={() => void remove()}
          className={`btn-ghost flex-1 ${deleting ? '!border-down !text-down' : ''}`}
        >
          {deleting ? 'Confirm delete' : 'Delete'}
        </button>
        <button onClick={() => void save()} disabled={busy} className="btn-primary flex-1">
          {busy ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </Drawer>
  );
}

/* --------------------------------- legal pages ------------------------------ */

function LegalTab() {
  const [pages, setPages] = useState<LegalPage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<LegalPage | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await api.get<{ pages: LegalPage[] }>('/admin/content/legal');
      setPages(data.pages);
      setOpen((current) => (current ? (data.pages.find((p) => p.slug === current.slug) ?? null) : null));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the legal pages');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <ErrorCard message={error} onRetry={load} />;
  if (!pages) return <Loading rows={5} cols={3} />;

  return (
    <>
      <p className="mb-3 text-xs text-slate-500">
        Placeholder text is not legal advice. Real launch copy needs a lawyer's review before it replaces
        these drafts.
      </p>
      <Table head={['Page', 'State', 'Last published']}>
        {pages.map((page) => (
          <tr key={page.slug} className="cursor-pointer transition hover:bg-ink-700/40" onClick={() => setOpen(page)}>
            <Td className="text-sm font-semibold">{page.title}</Td>
            <Td>
              <PublishBadge publishedAt={page.publishedAt} hasDraftAhead={page.draftBody !== page.publishedBody} />
            </Td>
            <Td className="text-xs text-slate-400">{page.publishedAt ? dateTime(page.publishedAt) : 'never'}</Td>
          </tr>
        ))}
      </Table>
      {open && <LegalPageDrawer page={open} onClose={() => setOpen(null)} onSaved={load} />}
    </>
  );
}

function LegalPageDrawer({
  page,
  onClose,
  onSaved,
}: {
  page: LegalPage;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [body, setBody] = useState(page.draftBody);
  const [busy, setBusy] = useState<'save' | 'publish' | null>(null);

  const save = async () => {
    setBusy('save');
    try {
      await api.put(`/admin/content/legal/${page.slug}`, { body });
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
      await api.put(`/admin/content/legal/${page.slug}`, { body });
      await api.post(`/admin/content/legal/${page.slug}/publish`);
      toast.success(`${page.title} published`);
      onSaved();
    } catch (err) {
      toast.error('Could not publish', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Drawer title={page.title} onClose={onClose}>
      <MarkdownEditor id="legal-body" label="Document text" value={body} onChange={setBody} rows={16} />
      {page.publishedAt && (
        <p className="text-[11px] text-slate-500">Last published {dateTime(page.publishedAt)}.</p>
      )}
      <div className="flex gap-2 pt-2">
        <button onClick={() => void save()} disabled={busy !== null} className="btn-ghost flex-1">
          {busy === 'save' ? 'Saving…' : 'Save draft'}
        </button>
        <button onClick={() => void publish()} disabled={busy !== null} className="btn-primary flex-1">
          {busy === 'publish' ? 'Publishing…' : 'Publish'}
        </button>
      </div>
    </Drawer>
  );
}

/* ------------------------------- announcements ------------------------------- */

const STYLE_LABEL: Record<AnnouncementStyle, string> = { info: 'Info', warning: 'Warning', success: 'Success' };

function AnnouncementsTab() {
  const [items, setItems] = useState<Announcement[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Announcement | null>(null);
  const [form, setForm] = useState({
    message: '',
    style: 'info' as AnnouncementStyle,
    linkLabel: '',
    linkUrl: '',
    active: true,
    startsAt: '',
    endsAt: '',
  });

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await api.get<{ announcements: Announcement[] }>('/admin/content/announcements');
      setItems(data.announcements);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the announcements');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      await api.post('/admin/content/announcements', {
        message: form.message,
        style: form.style,
        linkLabel: form.linkLabel || null,
        linkUrl: form.linkUrl || null,
        active: form.active,
        startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : null,
        endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : null,
      });
      setForm({ message: '', style: 'info', linkLabel: '', linkUrl: '', active: true, startsAt: '', endsAt: '' });
      toast.success('Announcement created');
      void load();
    } catch (err) {
      toast.error('Could not create it', err instanceof ApiError ? err.message : undefined);
    }
  };

  const toggleActive = async (item: Announcement) => {
    try {
      await api.patch(`/admin/content/announcements/${item.id}`, { active: !item.active });
      void load();
    } catch (err) {
      toast.error('Could not update it', err instanceof ApiError ? err.message : undefined);
    }
  };

  if (error) return <ErrorCard message={error} onRetry={load} />;

  return (
    <>
      <form onSubmit={create} className="card mb-4 grid gap-3 p-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="label" htmlFor="an-message">
            Message
          </label>
          <input
            id="an-message"
            required
            value={form.message}
            onChange={(e) => setForm({ ...form, message: e.target.value })}
            className="field"
            placeholder="Scheduled maintenance Sunday 02:00 UTC."
          />
        </div>
        <div>
          <label className="label" htmlFor="an-style">
            Style
          </label>
          <select
            id="an-style"
            value={form.style}
            onChange={(e) => setForm({ ...form, style: e.target.value as AnnouncementStyle })}
            className="field"
          >
            {(Object.keys(STYLE_LABEL) as AnnouncementStyle[]).map((key) => (
              <option key={key} value={key}>
                {STYLE_LABEL[key]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-end gap-2">
          <input
            id="an-active"
            type="checkbox"
            checked={form.active}
            onChange={(e) => setForm({ ...form, active: e.target.checked })}
            className="h-4 w-4"
          />
          <label htmlFor="an-active" className="text-sm text-slate-300">
            Active immediately
          </label>
        </div>
        <div>
          <label className="label" htmlFor="an-link-label">
            Link label (optional)
          </label>
          <input
            id="an-link-label"
            value={form.linkLabel}
            onChange={(e) => setForm({ ...form, linkLabel: e.target.value })}
            className="field"
          />
        </div>
        <div>
          <label className="label" htmlFor="an-link-url">
            Link URL (optional)
          </label>
          <input
            id="an-link-url"
            value={form.linkUrl}
            onChange={(e) => setForm({ ...form, linkUrl: e.target.value })}
            className="field"
          />
        </div>
        <div>
          <label className="label" htmlFor="an-starts">
            Starts (optional)
          </label>
          <input
            id="an-starts"
            type="datetime-local"
            value={form.startsAt}
            onChange={(e) => setForm({ ...form, startsAt: e.target.value })}
            className="field"
          />
        </div>
        <div>
          <label className="label" htmlFor="an-ends">
            Ends (optional)
          </label>
          <input
            id="an-ends"
            type="datetime-local"
            value={form.endsAt}
            onChange={(e) => setForm({ ...form, endsAt: e.target.value })}
            className="field"
          />
        </div>
        <div className="sm:col-span-2">
          <button type="submit" className="btn-primary">
            Create announcement
          </button>
        </div>
      </form>

      {!error && items === null && <Loading rows={4} cols={4} />}
      {!error && items !== null && items.length === 0 && <Empty text="No announcements." />}
      {!error && items !== null && items.length > 0 && (
        <Table head={['Message', 'Style', 'Window', 'State']}>
          {items.map((item) => (
            <tr key={item.id} className="transition hover:bg-ink-700/40">
              <Td>
                <button onClick={() => setOpen(item)} className="max-w-xs truncate text-left text-sm hover:text-accent">
                  {item.message}
                </button>
              </Td>
              <Td className="text-xs text-slate-400">{STYLE_LABEL[item.style]}</Td>
              <Td className="text-[11px] text-slate-500">
                {item.startsAt ? dateTime(item.startsAt) : 'now'} → {item.endsAt ? dateTime(item.endsAt) : 'no end'}
              </Td>
              <Td>
                <button onClick={() => void toggleActive(item)} className="inline-flex">
                  <StatusPill status={item.active ? 'active' : 'closed'} />
                </button>
              </Td>
            </tr>
          ))}
        </Table>
      )}

      {open && <AnnouncementDrawer item={open} onClose={() => setOpen(null)} onSaved={load} />}
    </>
  );
}

function AnnouncementDrawer({
  item,
  onClose,
  onSaved,
}: {
  item: Announcement;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [message, setMessage] = useState(item.message);
  const [style, setStyle] = useState<AnnouncementStyle>(item.style);
  const [linkLabel, setLinkLabel] = useState(item.linkLabel ?? '');
  const [linkUrl, setLinkUrl] = useState(item.linkUrl ?? '');
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await api.patch(`/admin/content/announcements/${item.id}`, {
        message,
        style,
        linkLabel: linkLabel || null,
        linkUrl: linkUrl || null,
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

  const remove = async () => {
    if (!deleting) {
      setDeleting(true);
      return;
    }
    try {
      await api.del(`/admin/content/announcements/${item.id}`);
      toast.success('Deleted');
      onSaved();
      onClose();
    } catch (err) {
      toast.error('Could not delete it', err instanceof ApiError ? err.message : undefined);
    }
  };

  return (
    <Drawer title="Edit announcement" onClose={onClose}>
      <div>
        <label className="label" htmlFor="an-e-message">
          Message
        </label>
        <input
          id="an-e-message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          className="field"
        />
      </div>
      <div>
        <label className="label" htmlFor="an-e-style">
          Style
        </label>
        <select
          id="an-e-style"
          value={style}
          onChange={(e) => setStyle(e.target.value as AnnouncementStyle)}
          className="field"
        >
          {(Object.keys(STYLE_LABEL) as AnnouncementStyle[]).map((key) => (
            <option key={key} value={key}>
              {STYLE_LABEL[key]}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="an-e-link-label">
          Link label
        </label>
        <input
          id="an-e-link-label"
          value={linkLabel}
          onChange={(e) => setLinkLabel(e.target.value)}
          className="field"
        />
      </div>
      <div>
        <label className="label" htmlFor="an-e-link-url">
          Link URL
        </label>
        <input id="an-e-link-url" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} className="field" />
      </div>
      <div className="flex gap-2 pt-2">
        <button
          onClick={() => void remove()}
          className={`btn-ghost flex-1 ${deleting ? '!border-down !text-down' : ''}`}
        >
          {deleting ? 'Confirm delete' : 'Delete'}
        </button>
        <button onClick={() => void save()} disabled={busy} className="btn-primary flex-1">
          {busy ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </Drawer>
  );
}

function ErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="card p-6 text-center">
      <p className="text-sm text-slate-300">{message}</p>
      <button onClick={onRetry} className="btn-primary mt-4">
        Try again
      </button>
    </div>
  );
}
