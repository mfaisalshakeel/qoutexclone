import type { Plot, PriceRange } from './types';

/**
 * The parts of interaction that are arithmetic rather than plumbing: how a
 * flick decays, how a pinch becomes a zoom, and how a dragged price axis moves
 * the range.
 */

/** Per-frame decay at 60fps. A flick should die in about half a second. */
const FRICTION = 0.92;
/** Below this, the movement is invisible and the loop should stop. */
const MIN_VELOCITY = 0.02;
/** No flick may be faster than this, however violently it was thrown. */
const MAX_VELOCITY = 6;

/** Pixels per millisecond from a drag's last leg. */
export function velocityOf(dxPx: number, elapsedMs: number): number {
  if (elapsedMs <= 0) return 0;
  const velocity = dxPx / elapsedMs;
  return Math.max(-MAX_VELOCITY, Math.min(MAX_VELOCITY, velocity));
}

/** What a flick still has left after a frame, and how far it moved in it. */
export function glide(velocity: number, elapsedMs: number): { velocity: number; dxPx: number } | null {
  const frames = elapsedMs / 16.67;
  const next = velocity * FRICTION ** frames;
  if (Math.abs(next) < MIN_VELOCITY) return null;
  return { velocity: next, dxPx: next * elapsedMs };
}

/** The zoom factor a pinch asks for: fingers apart zooms in. */
export function pinchFactor(startGap: number, gap: number): number {
  if (!(startGap > 0) || !(gap > 0)) return 1;
  // fewer bars visible as the gap grows, so the factor is the inverse ratio
  return Math.min(Math.max(startGap / gap, 0.2), 5);
}

export function gapBetween(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Drags a manual price range up or down with the axis. */
export function shiftRange(range: PriceRange, dyPx: number, plot: Plot): PriceRange {
  if (plot.height <= 0) return range;
  const perPixel = (range.max - range.min) / plot.height;
  const delta = dyPx * perPixel;
  return { min: range.min + delta, max: range.max + delta };
}

/** Stretches a manual price range about its middle. */
export function scaleRange(range: PriceRange, factor: number): PriceRange {
  const middle = (range.min + range.max) / 2;
  const half = ((range.max - range.min) / 2) * Math.min(Math.max(factor, 0.05), 20);
  return { min: middle - half, max: middle + half };
}
