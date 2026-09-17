/**
 * Keyboard shortcuts for the terminal.
 *
 * Kept as pure data and pure functions so the binding a trader sees in the help
 * overlay, the binding stored in their browser, and the binding matched against
 * a keystroke are all the same thing.
 *
 * A shortcut must never fire while someone is typing. That is not a detail: the
 * ticket has a number field, and a platform where typing "25" places two trades
 * is worse than one with no shortcuts at all.
 */

export type HotkeyAction =
  | 'higher'
  | 'lower'
  | 'amountUp'
  | 'amountDown'
  | 'expiryUp'
  | 'expiryDown'
  | 'nextAsset'
  | 'prevAsset'
  | 'help';

export interface Binding {
  /** `KeyboardEvent.key`, compared case-insensitively for printable keys. */
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
}

export type Bindings = Record<HotkeyAction, Binding>;

export const HOTKEY_ACTIONS: { action: HotkeyAction; label: string; help: string }[] = [
  { action: 'higher', label: 'Buy higher', help: 'Open an UP position with the current ticket' },
  { action: 'lower', label: 'Buy lower', help: 'Open a DOWN position with the current ticket' },
  { action: 'amountUp', label: 'Amount +', help: 'Raise the stake by one step' },
  { action: 'amountDown', label: 'Amount −', help: 'Lower the stake by one step' },
  { action: 'expiryUp', label: 'Expiry +', help: 'Next expiry in the list' },
  { action: 'expiryDown', label: 'Expiry −', help: 'Previous expiry in the list' },
  { action: 'nextAsset', label: 'Next market', help: 'Move down the market list' },
  { action: 'prevAsset', label: 'Previous market', help: 'Move up the market list' },
  { action: 'help', label: 'Shortcuts', help: 'Show or hide this list' },
];

/**
 * WASD for trading, brackets for markets. Chosen to avoid the keys a browser
 * already owns: no arrows (they scroll), no single letters that collide with
 * find-as-you-type, and nothing needing a modifier.
 */
export const DEFAULT_BINDINGS: Bindings = {
  higher: { key: 'w' },
  lower: { key: 's' },
  amountUp: { key: 'd' },
  amountDown: { key: 'a' },
  expiryUp: { key: 'e' },
  expiryDown: { key: 'q' },
  nextAsset: { key: ']' },
  prevAsset: { key: '[' },
  help: { key: '?' },
};

const STORAGE_KEY = 'qx.hotkeys';

/** A binding as a trader reads it: ⇧D, Ctrl+K, Space. */
export function formatBinding(binding: Binding): string {
  const parts: string[] = [];
  if (binding.ctrl) parts.push('Ctrl');
  if (binding.alt) parts.push('Alt');
  if (binding.shift) parts.push('⇧');
  const key =
    binding.key === ' ' ? 'Space' : binding.key.length === 1 ? binding.key.toUpperCase() : binding.key;
  parts.push(key);
  return parts.join('+');
}

/** The binding a keystroke represents, or null when it is only a modifier. */
export function bindingFromEvent(event: KeyboardEvent): Binding | null {
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) return null;
  return {
    key: event.key,
    ...(event.ctrlKey || event.metaKey ? { ctrl: true } : {}),
    ...(event.altKey ? { alt: true } : {}),
    // shift is only recorded for keys where it is not already in the character
    ...(event.shiftKey && event.key.length > 1 ? { shift: true } : {}),
  };
}

export function bindingsEqual(a: Binding, b: Binding): boolean {
  return (
    a.key.toLowerCase() === b.key.toLowerCase() &&
    !!a.ctrl === !!b.ctrl &&
    !!a.alt === !!b.alt &&
    !!a.shift === !!b.shift
  );
}

/** Does this keystroke trigger this binding? */
export function matches(binding: Binding, event: KeyboardEvent): boolean {
  const from = bindingFromEvent(event);
  return from ? bindingsEqual(binding, from) : false;
}

/**
 * Is the keystroke going somewhere that owns it?
 *
 * Any editable target, and anything inside one, keeps its own keys — including
 * `contenteditable`, which is not an input but behaves like one.
 */
export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  // a custom control may wrap a field; the closest editable ancestor decides
  return target.closest('input, textarea, select, [contenteditable="true"]') !== null;
}

/** The action a keystroke maps to, or null. */
export function actionFor(bindings: Bindings, event: KeyboardEvent): HotkeyAction | null {
  for (const { action } of HOTKEY_ACTIONS) {
    if (matches(bindings[action], event)) return action;
  }
  return null;
}

/** Which actions share a binding, so the editor can say so. */
export function conflicts(bindings: Bindings): HotkeyAction[] {
  const clashing = new Set<HotkeyAction>();
  const actions = HOTKEY_ACTIONS.map((entry) => entry.action);
  for (let i = 0; i < actions.length; i += 1) {
    for (let j = i + 1; j < actions.length; j += 1) {
      if (bindingsEqual(bindings[actions[i]], bindings[actions[j]])) {
        clashing.add(actions[i]);
        clashing.add(actions[j]);
      }
    }
  }
  return [...clashing];
}

export interface HotkeyPreferences {
  enabled: boolean;
  bindings: Bindings;
}

export const DEFAULT_PREFERENCES: HotkeyPreferences = {
  enabled: true,
  bindings: DEFAULT_BINDINGS,
};

/**
 * Reads the trader's preferences. Storage may be unavailable or hold something
 * from an older version, so anything unrecognised falls back to the default for
 * that one action rather than throwing the whole set away.
 */
export function loadPreferences(): HotkeyPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PREFERENCES;
    const parsed = JSON.parse(raw) as Partial<HotkeyPreferences>;
    const bindings = { ...DEFAULT_BINDINGS };
    for (const { action } of HOTKEY_ACTIONS) {
      const stored = parsed.bindings?.[action];
      if (stored && typeof stored.key === 'string' && stored.key.length > 0) {
        bindings[action] = {
          key: stored.key,
          ...(stored.ctrl ? { ctrl: true } : {}),
          ...(stored.alt ? { alt: true } : {}),
          ...(stored.shift ? { shift: true } : {}),
        };
      }
    }
    return { enabled: parsed.enabled !== false, bindings };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export function savePreferences(preferences: HotkeyPreferences): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    /* a browser with storage blocked keeps the defaults for the session */
  }
}
