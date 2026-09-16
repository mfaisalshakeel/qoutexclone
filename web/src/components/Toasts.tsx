import { useToasts } from '../store/toast';

const TONES: Record<string, string> = {
  success: 'border-up/40 bg-up-soft text-up',
  error: 'border-down/40 bg-down-soft text-down',
  info: 'border-accent/40 bg-accent-soft text-accent',
};

export function Toasts() {
  const { toasts, dismiss } = useToasts();

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-4 sm:bottom-auto sm:right-4 sm:top-[4.25rem] sm:items-end">
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
