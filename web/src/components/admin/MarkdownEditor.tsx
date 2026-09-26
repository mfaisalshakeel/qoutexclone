import { useId, useState } from 'react';
import { renderMarkdown } from '../../lib/markdown';

/**
 * A plain textarea with a "Write / Preview" toggle, rather than a WYSIWYG
 * widget: the CMS's own content (legal text, FAQ answers, homepage copy) is
 * prose with the occasional heading or link, and markdown edits and diffs
 * cleanly as plain text, which a rich-text binary blob does not.
 */
export function MarkdownEditor({
  value,
  onChange,
  rows = 10,
  label,
  id,
}: {
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  label: string;
  id?: string;
}) {
  const [tab, setTab] = useState<'write' | 'preview'>('write');
  const autoId = useId();
  const textareaId = id ?? autoId;

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <label className="label" htmlFor={textareaId}>
          {label}
        </label>
        <div role="tablist" aria-label={`${label} view`} className="flex gap-1">
          {(['write', 'preview'] as const).map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={`rounded px-2 py-0.5 text-[11px] font-semibold transition ${
                tab === key ? 'bg-ink-600 text-white' : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {key === 'write' ? 'Write' : 'Preview'}
            </button>
          ))}
        </div>
      </div>

      {tab === 'write' ? (
        <textarea
          id={textareaId}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          rows={rows}
          className="field font-mono text-xs leading-relaxed"
          placeholder="Markdown: **bold**, _italic_, # headings, [links](https://…), - lists"
        />
      ) : (
        <div
          className="markdown-body min-h-[8rem] rounded-lg border border-ink-500 bg-ink-900 p-3 text-sm text-slate-200"
          style={{ minHeight: `${rows * 1.5}rem` }}
          // sanitised by renderMarkdown before it ever reaches innerHTML
          dangerouslySetInnerHTML={{ __html: value.trim() ? renderMarkdown(value) : '<p class="text-slate-500">Nothing to preview yet.</p>' }}
        />
      )}
    </div>
  );
}
