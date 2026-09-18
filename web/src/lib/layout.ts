/**
 * Terminal chart layouts.
 *
 * One chart, two side by side or stacked, or four. Each pane carries its own
 * market and timeframe, and one pane is focused: the ticket, the header and the
 * positions all follow it, so there is never a question of which chart a trade
 * belongs to.
 *
 * Pure, so changing layout is a data transformation that can be reasoned about
 * rather than a pile of conditional rendering.
 */

export type LayoutKind = 'single' | 'rows' | 'cols' | 'quad';

export interface Pane {
  symbol: string;
  timeframe: string;
}

export interface TerminalLayout {
  kind: LayoutKind;
  panes: Pane[];
  /** Index of the pane the ticket trades from. */
  focused: number;
}

export const LAYOUTS: { kind: LayoutKind; label: string; panes: number }[] = [
  { kind: 'single', label: 'Single', panes: 1 },
  { kind: 'cols', label: 'Side by side', panes: 2 },
  { kind: 'rows', label: 'Stacked', panes: 2 },
  { kind: 'quad', label: 'Four', panes: 4 },
];

export function paneCount(kind: LayoutKind): number {
  return LAYOUTS.find((each) => each.kind === kind)?.panes ?? 1;
}

/** Tailwind grid classes for a layout, at the breakpoint where it applies. */
export function gridClass(kind: LayoutKind): string {
  switch (kind) {
    case 'cols':
      return 'grid-cols-1 md:grid-cols-2 md:grid-rows-1';
    case 'rows':
      return 'grid-cols-1 grid-rows-2';
    case 'quad':
      return 'grid-cols-1 md:grid-cols-2 grid-rows-2';
    default:
      return 'grid-cols-1 grid-rows-1';
  }
}

/**
 * Fits the panes to a layout: keeps what is there, fills any new pane from the
 * last one, and drops the extras. Switching to four charts and back leaves the
 * first pane exactly as it was.
 */
export function resize(panes: Pane[], kind: LayoutKind, fallback: Pane): Pane[] {
  const wanted = paneCount(kind);
  const kept = panes.slice(0, wanted);
  while (kept.length < wanted) {
    kept.push({ ...(kept[kept.length - 1] ?? fallback) });
  }
  return kept;
}

/** Keeps the focus on a pane that exists. */
export function clampFocus(focused: number, kind: LayoutKind): number {
  const last = paneCount(kind) - 1;
  if (!Number.isFinite(focused)) return 0;
  return Math.min(Math.max(Math.floor(focused), 0), last);
}

export function defaultLayout(symbol: string, timeframe: string): TerminalLayout {
  return { kind: 'single', panes: [{ symbol, timeframe }], focused: 0 };
}

/**
 * Reads a layout that came from the server, where it is whatever was stored the
 * last time — possibly by an older version. Anything unrecognised falls back
 * rather than leaving the terminal unable to render.
 */
export function parseLayout(value: unknown, fallback: TerminalLayout): TerminalLayout {
  if (!value || typeof value !== 'object') return fallback;
  const raw = value as Partial<TerminalLayout>;
  const kind = LAYOUTS.some((each) => each.kind === raw.kind) ? (raw.kind as LayoutKind) : 'single';

  const panes: Pane[] = Array.isArray(raw.panes)
    ? raw.panes
        .filter(
          (pane): pane is Pane =>
            !!pane &&
            typeof (pane as Pane).symbol === 'string' &&
            typeof (pane as Pane).timeframe === 'string' &&
            (pane as Pane).symbol.length > 0,
        )
        .map((pane) => ({ symbol: pane.symbol, timeframe: pane.timeframe }))
    : [];

  const fitted = resize(panes.length ? panes : fallback.panes, kind, fallback.panes[0]);
  return { kind, panes: fitted, focused: clampFocus(raw.focused ?? 0, kind) };
}

/** Sets one pane's market or timeframe, leaving the others alone. */
export function updatePane(layout: TerminalLayout, index: number, patch: Partial<Pane>): TerminalLayout {
  if (index < 0 || index >= layout.panes.length) return layout;
  return {
    ...layout,
    panes: layout.panes.map((pane, at) => (at === index ? { ...pane, ...patch } : pane)),
  };
}
