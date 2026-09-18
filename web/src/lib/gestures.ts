/**
 * Touch gestures, as pure functions.
 *
 * A swipe is a judgement — how far, how straight, how fast — and judgements
 * belong somewhere they can be tested rather than discovered on a phone. The
 * components here only feed in two points and a duration.
 */

export interface Point {
  x: number;
  y: number;
}

export type SwipeDirection = 'left' | 'right' | 'up' | 'down';

/** Shorter than this is a tap or a wobble, not a swipe. */
export const SWIPE_MIN_PX = 48;

/**
 * How straight a swipe has to be: the off-axis movement may be at most this
 * share of the movement along the axis. A finger arcs, so this is generous —
 * but a 45° drag is nobody's idea of a horizontal swipe.
 */
const STRAIGHTNESS = 0.75;

export function swipeOf(start: Point, end: Point, options: { min?: number } = {}): SwipeDirection | null {
  const min = options.min ?? SWIPE_MIN_PX;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const horizontal = Math.abs(dx) >= Math.abs(dy);

  if (horizontal) {
    if (Math.abs(dx) < min) return null;
    if (Math.abs(dy) > Math.abs(dx) * STRAIGHTNESS) return null;
    return dx < 0 ? 'left' : 'right';
  }
  if (Math.abs(dy) < min) return null;
  if (Math.abs(dx) > Math.abs(dy) * STRAIGHTNESS) return null;
  return dy < 0 ? 'up' : 'down';
}

/**
 * The tab a swipe lands on.
 *
 * Swiping left moves to the next tab, the way a carousel does — the content
 * follows the finger. The ends do not wrap: a swipe past the last tab should
 * feel like the end of the list, not like being thrown back to the start.
 */
export function tabAfterSwipe<T>(tabs: readonly T[], current: T, direction: SwipeDirection): T {
  if (direction !== 'left' && direction !== 'right') return current;
  const at = tabs.indexOf(current);
  if (at < 0) return current;
  const next = direction === 'left' ? at + 1 : at - 1;
  return tabs[Math.min(Math.max(next, 0), tabs.length - 1)];
}

/**
 * Whether a downward drag should close a sheet.
 *
 * Either it has been pulled far enough — a third of its height — or it was
 * flicked: a short, fast pull is a dismissal too, which is what makes a sheet
 * feel native rather than like a div that moved.
 */
export function shouldDismiss(input: {
  /** How far the sheet has been dragged down, in pixels. */
  dragged: number;
  /** The sheet's height, in pixels. */
  height: number;
  /** How long the drag took, in milliseconds. */
  elapsed: number;
}): boolean {
  if (input.dragged <= 0) return false;
  if (input.height > 0 && input.dragged >= input.height / 3) return true;

  const velocity = input.elapsed > 0 ? input.dragged / input.elapsed : 0;
  // px per ms — half a screen per second is a flick
  return input.dragged >= SWIPE_MIN_PX && velocity >= 0.5;
}

/** How far the sheet follows the finger: down freely, up not at all. */
export function dragOffset(startY: number, currentY: number): number {
  return Math.max(0, currentY - startY);
}
