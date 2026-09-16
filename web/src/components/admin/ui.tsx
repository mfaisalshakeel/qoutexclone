import type { ReactNode } from 'react';

/** Page header inside the admin shell. */
export function PageHead({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'up' | 'down' | 'warn';
}) {
  const toneClass = tone === 'up' ? 'text-up' : tone === 'down' ? 'text-down' : tone === 'warn' ? 'text-amber-300' : '';
  return (
    <div className="card p-4">
      <p className="text-[10px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`tabular mt-1 text-xl font-bold ${toneClass}`}>{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-slate-500">{hint}</p>}
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
  return <span className={`chip ${STATUS_TONES[key] ?? 'bg-ink-600 text-slate-300'}`}>{key}</span>;
}

/** Responsive table: real table on desktop, stacked cards on phones. */
export function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[42rem] text-sm">
          <thead className="bg-ink-700/60 text-[10px] uppercase tracking-wide text-slate-400">
            <tr>
              {head.map((label, i) => (
                <th key={label} className={`px-4 py-2.5 font-medium ${i === head.length - 1 ? 'text-right' : 'text-left'}`}>
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-700">{children}</tbody>
        </table>
      </div>
    </div>
  );
}

export function Td({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <td className={`px-4 py-3 align-top ${className}`}>{children}</td>;
}

export function Empty({ text }: { text: string }) {
  return (
    <div className="card p-12 text-center">
      <p className="text-sm text-slate-500">{text}</p>
    </div>
  );
}

export function Loading() {
  return <div className="card h-40 animate-pulse" />;
}
