import { useEffect, useRef, useState, type ReactNode } from 'react';
import { dragOffset, shouldDismiss } from '../lib/gestures';

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Hidden titles still name the sheet for a screen reader. */
  hideTitle?: boolean;
  children: ReactNode;
  /** Kept mounted while closed, for a sheet whose contents hold state. */
  keepMounted?: boolean;
}

/**
 * A sheet that rises from the bottom of a phone screen.
 *
 * It behaves the way a native one does: it can be pulled down to dismiss, it
 * sits above the home indicator rather than under it, and the page behind it
 * does not scroll while it is open. `keepMounted` is for the trade ticket,
 * which has to keep its stake and expiry — and stay reachable through its
 * imperative handle — while it is out of sight.
 */
export function BottomSheet({ open, onClose, title, hideTitle, children, keepMounted }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; at: number } | null>(null);
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    // the page behind a sheet must not scroll with it
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  // a sheet that reopens where it was left dragged looks broken
  useEffect(() => {
    if (!open) setOffset(0);
  }, [open]);

  if (!open && !keepMounted) return null;

  const start = (event: React.TouchEvent) => {
    const touch = event.touches[0];
    if (touch) drag.current = { y: touch.clientY, at: Date.now() };
  };

  const move = (event: React.TouchEvent) => {
    const touch = event.touches[0];
    if (!drag.current || !touch) return;
    setOffset(dragOffset(drag.current.y, touch.clientY));
  };

  const end = () => {
    const started = drag.current;
    drag.current = null;
    if (!started) return;
    const height = panelRef.current?.offsetHeight ?? 0;
    if (shouldDismiss({ dragged: offset, height, elapsed: Date.now() - started.at })) onClose();
    setOffset(0);
  };

  return (
    <div
      className={`fixed inset-0 z-50 md:hidden ${open ? '' : 'pointer-events-none hidden'}`}
      aria-hidden={!open}
    >
      <button
        aria-label={`Close ${title.toLowerCase()}`}
        onClick={onClose}
        className="absolute inset-0 bg-ink-900/70 backdrop-blur-[2px]"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{ transform: offset ? `translateY(${offset}px)` : undefined }}
        className={`absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-2xl border-t border-ink-500 bg-ink-800 pb-[env(safe-area-inset-bottom)] shadow-2xl ${
          offset ? '' : 'motion-safe:animate-fade-up'
        }`}
      >
        {/* the grab area: a real handle to pull, and a real button to close */}
        <div
          onTouchStart={start}
          onTouchMove={move}
          onTouchEnd={end}
          className="sticky top-0 z-10 flex items-center gap-2 rounded-t-2xl bg-ink-800 px-3 pb-2 pt-2.5"
        >
          <span
            aria-hidden="true"
            className="absolute inset-x-0 top-1.5 mx-auto h-1 w-10 rounded-full bg-ink-500"
          />
          {!hideTitle && <h2 className="mt-2 text-sm font-semibold text-white">{title}</h2>}
          {/* its own word is a better name than a label nobody reads, and it
              keeps this button distinct from the backdrop, which closes too */}
          <button
            onClick={onClose}
            className="ml-auto mt-2 rounded-lg px-2 py-1 text-xs font-semibold text-slate-400 transition hover:bg-ink-700 hover:text-slate-200"
          >
            Done
          </button>
        </div>
        <div className="px-2 pb-3">{children}</div>
      </div>
    </div>
  );
}
