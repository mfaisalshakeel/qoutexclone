import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Trans, useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { renderMarkdown } from '../../lib/markdown';
import { usePageMeta } from '../../hooks/usePageMeta';
import { faqPageJsonLd } from '../../lib/structuredData';
import { PublicHeader } from '../../components/home/PublicHeader';
import { SiteFooter } from '../../components/home/Sections';
import { RowSkeletons } from '../../components/Skeleton';
import type { FaqEntry } from '../../lib/types';

/** The full help centre: every published FAQ entry, searchable and grouped by category. */
export function PublicHelp() {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<FaqEntry[] | null>(null);

  usePageMeta({
    title: t('help.title'),
    description: t('help.subtitle'),
    jsonLd: entries?.length
      ? faqPageJsonLd(entries.map((e) => ({ question: e.question, answer: e.answer })))
      : undefined,
  });
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ entries: FaqEntry[] }>('/content/faq')
      .then(({ entries: list }) => setEntries(list))
      .catch(() => setEntries([]));
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries ?? [];
    return (entries ?? []).filter(
      (e) =>
        e.question.toLowerCase().includes(q) ||
        e.answer.toLowerCase().includes(q) ||
        e.category.toLowerCase().includes(q),
    );
  }, [entries, query]);

  const byCategory = useMemo(() => {
    const map = new Map<string, FaqEntry[]>();
    for (const entry of filtered) {
      const list = map.get(entry.category) ?? [];
      list.push(entry);
      map.set(entry.category, list);
    }
    return map;
  }, [filtered]);

  return (
    <div className="min-h-dvh">
      <PublicHeader />
      <main className="mx-auto max-w-3xl px-4 pb-20 pt-4">
        <h1 className="text-3xl font-bold tracking-tight">{t('help.title')}</h1>
        <p className="mt-2 text-sm text-slate-400">{t('help.subtitle')}</p>

        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('help.searchPlaceholder')}
          aria-label={t('help.searchPlaceholder')}
          className="field mt-6"
        />

        <div className="mt-6">
          {entries === null && <RowSkeletons rows={6} rowClassName="card mb-3 p-4" />}
          {entries !== null && filtered.length === 0 && (
            <p className="card p-6 text-center text-sm text-slate-500">
              <Trans
                i18nKey="help.noMatch"
                values={{ query }}
                components={{
                  contactLink: <Link to="/contact" className="text-accent hover:underline" />,
                }}
              />
            </p>
          )}
          {[...byCategory.entries()].map(([category, items]) => (
            <div key={category} className="mb-8">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
                {category}
              </h2>
              <div className="divide-y divide-ink-700 rounded-xl border border-ink-700 bg-ink-800">
                {items.map((entry) => {
                  const open = openId === entry.id;
                  return (
                    <div key={entry.id}>
                      <button
                        onClick={() => setOpenId(open ? null : entry.id)}
                        aria-expanded={open}
                        className="flex w-full items-center justify-between gap-3 p-4 text-start text-sm font-semibold hover:bg-ink-700/40"
                      >
                        {entry.question}
                        <span aria-hidden className="text-slate-500">
                          {open ? '−' : '+'}
                        </span>
                      </button>
                      {open && (
                        <div
                          className="markdown-body px-4 pb-4 text-sm text-slate-400"
                          dangerouslySetInnerHTML={{ __html: renderMarkdown(entry.answer) }}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="card mt-4 p-6 text-center">
          <p className="text-sm font-semibold">{t('help.stillStuckTitle')}</p>
          <p className="mt-1 text-sm text-slate-400">{t('help.stillStuckBody')}</p>
          <Link to="/contact" className="btn-primary mt-4 inline-flex !px-5 !py-2.5">
            {t('help.contactSupport')}
          </Link>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
