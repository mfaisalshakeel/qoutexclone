import { useEffect, useRef, useState } from 'react';
import {
  HOTKEY_ACTIONS,
  bindingFromEvent,
  conflicts,
  formatBinding,
  type HotkeyAction,
} from '../lib/hotkeys';
import type { HotkeysState } from '../hooks/useHotkeys';

interface Props {
  state: HotkeysState;
  onClose: () => void;
}

/**
 * The shortcut list, and where they are changed.
 *
 * Rebinding captures the next keystroke rather than asking anyone to type a key
 * name. While it is capturing, every key belongs to the capture — including the
 * one that opened this overlay.
 */
export function HotkeyHelp({ state, onClose }: Props) {
  const [capturing, setCapturing] = useState<HotkeyAction | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const { preferences, rebind, setEnabled, reset } = state;
  const clashing = conflicts(preferences.bindings);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (capturing) {
        const binding = bindingFromEvent(event);
        if (!binding) return; // a modifier on its own is not a shortcut
        event.preventDefault();
        event.stopPropagation();
        if (binding.key !== 'Escape') rebind(capturing, binding);
        setCapturing(null);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    // capture phase, so a rebinding claims the key before the global handler
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [capturing, rebind, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        onClick={onClose}
        aria-label="Close shortcuts"
        className="absolute inset-0 bg-black/60"
        tabIndex={-1}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        className="relative max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl border border-ink-500 bg-ink-800 p-4 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-white">Keyboard shortcuts</h2>
            <p className="mt-0.5 text-xs text-slate-400">
              Click a key to change it. Shortcuts never fire while you are typing.
            </p>
          </div>
          <button
            ref={closeRef}
            onClick={onClose}
            className="rounded-lg bg-ink-600 px-2.5 py-1.5 text-xs font-semibold text-slate-200"
          >
            Close
          </button>
        </div>

        <label className="mt-3 flex items-center gap-2 rounded-lg bg-ink-900/60 px-3 py-2 text-xs text-slate-300">
          <input
            type="checkbox"
            checked={preferences.enabled}
            onChange={(event) => setEnabled(event.target.checked)}
            className="h-4 w-4 rounded border-ink-500 bg-ink-900"
          />
          Shortcuts enabled
        </label>

        {clashing.length > 0 && (
          <p className="mt-2 rounded-lg bg-down-soft px-3 py-2 text-xs text-down">
            Two actions share a key. The first in this list wins until you change one.
          </p>
        )}

        <ul className="mt-3 space-y-1">
          {HOTKEY_ACTIONS.map(({ action, label, help }) => (
            <li
              key={action}
              className="flex items-center justify-between gap-3 rounded-lg px-1 py-1.5 hover:bg-ink-700/40"
            >
              <span className="min-w-0">
                <span className="block truncate text-xs font-medium text-slate-200">{label}</span>
                <span className="block truncate text-[11px] text-slate-500">{help}</span>
              </span>
              <button
                onClick={() => setCapturing(action)}
                aria-label={`Change the shortcut for ${label}`}
                className={`shrink-0 rounded-md px-2.5 py-1 font-mono text-[11px] font-semibold ${
                  capturing === action
                    ? 'bg-accent text-white'
                    : clashing.includes(action)
                      ? 'bg-down/20 text-down'
                      : 'bg-ink-700 text-slate-200'
                }`}
              >
                {capturing === action ? 'Press a key…' : formatBinding(preferences.bindings[action])}
              </button>
            </li>
          ))}
        </ul>

        <button
          onClick={reset}
          className="mt-3 w-full rounded-lg bg-ink-700 py-2 text-xs font-semibold text-slate-300 hover:bg-ink-600"
        >
          Restore defaults
        </button>
      </div>
    </div>
  );
}
