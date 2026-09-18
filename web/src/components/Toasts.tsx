import { useToasts } from '../store/toast';

const TONES: Record<string, string> = {
  success: 'border-up/40 bg-up-soft text-up',
  error: 'border-down/40 bg-down-soft text-down',
  info: 'border-accent/40 bg-accent-soft text-accent',
};

export function Toasts() {
  const { toasts, dismiss } = useToasts();

  return (
    // below the header on a phone, not above the terminal's dock: a toast that
    // covers the buy buttons is in the way of the next trade
    <div className="pointer-events-none fixed inset-x-0 top-[4.25rem] z-50 flex flex-col items-center gap-2 px-4 sm:right-4 sm:items-end">
      {toasts.map((t) => (
        <button
          key={t.id}
          onClick={() => dismiss(t.id)}
          className={`pointer-events-auto w-full max-w-sm animate-fade-up rounded-xl border bg-ink-800/95 p-3 text-left shadow-xl backdrop-blur ${TONES[t.tone]}`}
        >
          <p className="text-sm font-semibold">{t.title}</p>
          {t.body && <p className="mt-0.5 text-xs text-slate-300">{t.body}</p>}
        </button>
      ))}
    </div>
  );
}
