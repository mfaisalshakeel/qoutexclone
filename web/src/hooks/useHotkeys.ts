import { useCallback, useEffect, useState } from 'react';
import {
  DEFAULT_PREFERENCES,
  actionFor,
  isTyping,
  loadPreferences,
  savePreferences,
  type Binding,
  type HotkeyAction,
  type HotkeyPreferences,
} from '../lib/hotkeys';

export type HotkeyHandlers = Partial<Record<HotkeyAction, () => void>>;

export interface HotkeysState {
  preferences: HotkeyPreferences;
  setEnabled: (enabled: boolean) => void;
  rebind: (action: HotkeyAction, binding: Binding) => void;
  reset: () => void;
}

/**
 * Binds the terminal's shortcuts.
 *
 * `enabled` is the platform switch and `preferences.enabled` the trader's own;
 * both have to be on. A keystroke that lands in a field is never claimed, and a
 * claimed one has its default prevented so the page does not also scroll.
 */
export function useHotkeys(handlers: HotkeyHandlers, enabled = true): HotkeysState {
  const [preferences, setPreferences] = useState<HotkeyPreferences>(() =>
    typeof window === 'undefined' ? DEFAULT_PREFERENCES : loadPreferences(),
  );

  const persist = useCallback((next: HotkeyPreferences) => {
    setPreferences(next);
    savePreferences(next);
  }, []);

  useEffect(() => {
    if (!enabled || !preferences.enabled) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (isTyping(event.target)) return;
      const action = actionFor(preferences.bindings, event);
      if (!action) return;
      const handler = handlers[action];
      if (!handler) return;
      event.preventDefault();
      handler();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled, preferences, handlers]);

  return {
    preferences,
    setEnabled: (value) => persist({ ...preferences, enabled: value }),
    rebind: (action, binding) =>
      persist({ ...preferences, bindings: { ...preferences.bindings, [action]: binding } }),
    reset: () => persist(DEFAULT_PREFERENCES),
  };
}
