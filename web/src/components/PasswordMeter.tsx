import { strength } from '../lib/password';

const BARS = 4;
const COLORS = ['bg-down', 'bg-down', 'bg-accent', 'bg-up/70', 'bg-up'];

/**
 * Feedback under a password field.
 *
 * It says one thing at a time — the next most useful change — because a list
 * of five rules under a field is read as a wall and ignored. The bar is
 * decorative; the words carry the meaning, and they are announced politely so
 * a screen reader is not interrupted on every keystroke.
 */
export function PasswordMeter({
  password,
  email,
  name,
}: {
  password: string;
  email?: string;
  name?: string;
}) {
  const { score, label, hint } = strength(password, { email, name });
  if (!password) return null;

  return (
    <div className="mt-2">
      <div className="flex gap-1" aria-hidden="true">
        {Array.from({ length: BARS }, (_, index) => (
          <span
            key={index}
            className={`h-1 flex-1 rounded-full transition-colors ${
              index < score ? COLORS[score] : 'bg-ink-600'
            }`}
          />
        ))}
      </div>
      <p aria-live="polite" className="mt-1.5 text-[11px] text-slate-400">
        <span className="font-semibold text-slate-300">{label}.</span>
        {hint ? ` ${hint}.` : ' This one is fine.'}
      </p>
    </div>
  );
}
