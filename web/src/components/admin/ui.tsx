import type { ReactNode } from 'react';
import { TableSkeleton } from '../Skeleton';

/** Page header inside the admin shell. */
export function PageHead({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-100">{title}</h1>
        {subtitle && <p className="mt-1 text-[13px] text-slate-500">{subtitle}</p>}
      </div>
      {action && <div className="flex flex-wrap items-center gap-2">{action}</div>}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  tone,
  delta,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'up' | 'down' | 'warn';
  /** A comparison badge (▲/▼ vs. the previous period), rendered beside the label. */
  delta?: ReactNode;
}) {
  const toneClass =
    tone === 'up'
      ? 'text-up'
      : tone === 'down'
        ? 'text-down'
        : tone === 'warn'
          ? 'text-amber-500 dark:text-amber-300'
          : 'text-slate-100';
  return (
    <div className="card-interactive p-5">
      <div className="flex items-start justify-between gap-2">
        <p className="section-title">{label}</p>
        {delta}
      </div>
      {/* the figure is the point of the card, so it gets the size and the
          weight; everything else on it is a caption */}
      <p className={`tabular mt-2 text-[26px] font-semibold leading-none tracking-tight ${toneClass}`}>
        {value}
      </p>
      {hint && <p className="mt-2 text-[11px] leading-snug text-slate-500">{hint}</p>}
    </div>
  );
}

const STATUS_TONES: Record<string, string> = {
  completed: 'bg-up-soft text-up',
  approved: 'bg-up-soft text-up',
  active: 'bg-up-soft text-up',
  running: 'bg-up-soft text-up',
  won: 'bg-up-soft text-up',
  pending: 'bg-amber-400/10 text-amber-300',
  processing: 'bg-accent-soft text-accent',
  confirming: 'bg-accent-soft text-accent',
  scheduled: 'bg-accent-soft text-accent',
  open: 'bg-accent-soft text-accent',
  connected: 'bg-up-soft text-up',
  connecting: 'bg-accent-soft text-accent',
  degraded: 'bg-amber-400/10 text-amber-300',
  unavailable: 'bg-ink-600 text-slate-400',
  stopped: 'bg-ink-600 text-slate-400',
  answered: 'bg-up-soft text-up',
  'awaiting payment': 'bg-amber-400/10 text-amber-300',
  rejected: 'bg-down-soft text-down',
  cancelled: 'bg-ink-600 text-slate-400',
  suspended: 'bg-down-soft text-down',
  expired: 'bg-ink-600 text-slate-400',
  closed: 'bg-ink-600 text-slate-400',
  finished: 'bg-ink-600 text-slate-400',
};

export function StatusPill({ status }: { status: string }) {
  const key = status.replace(/_/g, ' ').toLowerCase();
  return (
    <span className={`chip font-semibold ${STATUS_TONES[key] ?? 'bg-ink-600 text-slate-300'}`}>
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {key}
    </span>
  );
}

/**
 * A table that scrolls inside its own box at any width, rather than widening
 * the page — `min-w-0` on the card is what lets it actually shrink to fit a
 * narrow parent; without it a flex/grid ancestor can hold it to the table's
 * full intrinsic width instead of the viewport's.
 */
export function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="card min-w-0 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[42rem] text-sm">
          <thead className="sticky top-0 z-10 bg-ink-700/80 text-[10px] uppercase tracking-[0.1em] text-slate-500 backdrop-blur">
            <tr>
              {head.map((label, i) => (
                <th
                  key={label}
                  className={`whitespace-nowrap px-4 py-3 font-semibold ${
                    i === head.length - 1 ? 'text-right' : 'text-left'
                  }`}
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-700 [&>tr]:transition-colors [&>tr:hover]:bg-ink-700/40">
            {children}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function Td({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <td className={`px-4 py-3.5 align-top ${className}`}>{children}</td>;
}

export function Empty({ text }: { text: string }) {
  return (
    <div className="card flex flex-col items-center gap-3 p-12 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-ink-700 text-slate-500">
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6">
          <rect x="3.5" y="5" width="17" height="14" rx="2.5" />
          <path d="M3.5 10h17" strokeLinecap="round" />
        </svg>
      </span>
      <p className="text-sm text-slate-500">{text}</p>
    </div>
  );
}

/** Placeholder while a section loads — shaped like the table it becomes. */
export function Loading({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return <TableSkeleton rows={rows} cols={cols} />;
}

/**
 * One action in a table row. Icon-only, because a row that ends in three word
 * buttons spends more width on its verbs than on its data — the label is the
 * accessible name and the tooltip, so nothing is lost to a screen reader or to
 * a pointer that hovers.
 */
export function RowAction({
  label,
  icon,
  onClick,
  tone,
  disabled,
}: {
  label: string;
  icon: ReactNode;
  onClick: (event: React.MouseEvent) => void;
  tone?: 'danger';
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      disabled={disabled}
      className={tone === 'danger' ? 'btn-icon-danger' : 'btn-icon'}
    >
      <svg
        aria-hidden
        viewBox="0 0 24 24"
        className="h-[15px] w-[15px]"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {icon}
      </svg>
    </button>
  );
}

/** The glyphs the row actions share, so the same verb looks the same everywhere. */
export const ACTION_ICONS = {
  adjust: (
    <>
      <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="10" cy="17" r="2" />
    </>
  ),
  suspend: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M6.5 6.5l11 11" />
    </>
  ),
  activate: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8.5 12.5l2.5 2.5 4.5-5" />
    </>
  ),
  approve: <path d="M4.5 12.5l4.5 4.5L19.5 6.5" />,
  reject: <path d="M6 6l12 12M18 6L6 18" />,
  view: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="2.6" />
    </>
  ),
  edit: (
    <>
      <path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z" />
      <path d="M14.5 6.5l3 3" />
    </>
  ),
  remove: (
    <>
      <path d="M4 7h16M9.5 7V5h5v2M6.5 7l1 13h9l1-13" />
    </>
  ),
} as const;
