import { create } from 'zustand';

export type ThemeChoice = 'system' | 'light' | 'dark';

const KEY = 'qx.theme';

/** Resolved colours, cleared whenever the theme changes (see `apply`). */
const colorCache = new Map<string, string>();

/** What the OS asks for, when the choice is "system". */
function systemTheme(): 'light' | 'dark' {
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function storedChoice(): ThemeChoice {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'light' || saved === 'dark' || saved === 'system') return saved;
  } catch {
    /* private mode, blocked storage: fall through to the default */
  }
  return 'system';
}

/**
 * Writes the resolved theme where CSS can see it. `index.html` runs the same
 * two lines inline before first paint, so this only ever confirms what is
 * already on the element — a reload never flashes the other theme.
 */
function apply(resolved: 'light' | 'dark'): void {
  colorCache.clear();
  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.classList.toggle('dark', resolved === 'dark');
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', resolved === 'light' ? '#f4f6fb' : '#0a0e17');
}

interface ThemeState {
  choice: ThemeChoice;
  /** what is actually on screen once "system" is resolved */
  resolved: 'light' | 'dark';
  setChoice: (choice: ThemeChoice) => void;
}

export const useTheme = create<ThemeState>((set, get) => {
  const choice = storedChoice();
  const resolved = choice === 'system' ? systemTheme() : choice;
  apply(resolved);

  // a trader on "system" follows the OS as it changes, mid-session
  window.matchMedia?.('(prefers-color-scheme: light)').addEventListener?.('change', () => {
    if (get().choice !== 'system') return;
    const next = systemTheme();
    apply(next);
    set({ resolved: next });
  });

  return {
    choice,
    resolved,
    setChoice(next) {
      try {
        localStorage.setItem(KEY, next);
      } catch {
        /* the theme still applies for this session */
      }
      const applied = next === 'system' ? systemTheme() : next;
      apply(applied);
      set({ choice: next, resolved: applied });
    },
  };
});

/**
 * Reads a themed colour as a real `rgb()` string, for the places that paint
 * outside CSS — canvas charts and SVG written in JS. Call it at draw time, not
 * at module load, so a theme switch is picked up on the next frame.
 */
export function themeColor(name: string, alpha = 1): string {
  const key = `${name}@${alpha}`;
  const hit = colorCache.get(key);
  // a canvas frame reads a dozen of these; getComputedStyle on every one of
  // them, sixty times a second, is a measurable cost for a value that only
  // changes when the theme does — and `apply` clears the cache when it does
  if (hit) return hit;
  const value = getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();
  const resolved = !value
    ? alpha === 1
      ? '#888888'
      : `rgba(136,136,136,${alpha})`
    : alpha === 1
      ? `rgb(${value})`
      : `rgb(${value} / ${alpha})`;
  colorCache.set(key, resolved);
  return resolved;
}
