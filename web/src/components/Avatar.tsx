/** The palette the profile page offers, and what each one looks like. */
export const AVATAR_COLORS: Record<string, string> = {
  slate: 'bg-slate-500',
  amber: 'bg-amber-500',
  emerald: 'bg-emerald-500',
  sky: 'bg-sky-500',
  violet: 'bg-violet-500',
  rose: 'bg-rose-500',
  teal: 'bg-teal-500',
  orange: 'bg-orange-500',
};

/**
 * A trader's avatar: their initial on a colour they picked.
 *
 * Not an upload. Uploads need somewhere to put a file and something to check
 * what is in it, and that interface arrives with the KYC document store in
 * Phase 8 — a data URL in a database column is not the answer.
 */
export function Avatar({
  name,
  avatar,
  className = 'h-9 w-9 text-sm',
}: {
  name?: string | null;
  avatar?: string | null;
  className?: string;
}) {
  const colour = (avatar && AVATAR_COLORS[avatar]) || 'bg-ink-600';
  return (
    <span
      aria-hidden="true"
      className={`flex items-center justify-center rounded-full font-semibold uppercase text-white ${colour} ${className}`}
    >
      {name?.[0] ?? '?'}
    </span>
  );
}
