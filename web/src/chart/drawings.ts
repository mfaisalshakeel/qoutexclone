/**
 * The trader's own marks on the chart.
 *
 * Every shape is stored in *data* coordinates — a time and a price — never in
 * pixels, so a line drawn across a gap stays across that gap when the chart is
 * panned, zoomed or reopened tomorrow on another screen.
 *
 * All of this is pure: what a shape looks like, what counts as clicking one,
 * where dragging a handle puts it, and what a Fibonacci retracement's levels
 * are. The canvas only ever renders the answers.
 */

export type DrawingKind = 'trend' | 'horizontal' | 'ray' | 'vertical' | 'rect' | 'fib' | 'text';

export interface Point {
  /** Epoch seconds, as the candles carry it. */
  time: number;
  price: number;
}

export interface Drawing {
  id: string;
  kind: DrawingKind;
  /** One point for horizontal/vertical/text, two for everything else. */
  points: Point[];
  color: string;
  /** A locked drawing can be selected and read, but not moved or resized. */
  locked?: boolean;
  text?: string;
}

export const DRAWING_TOOLS: { kind: DrawingKind; label: string; glyph: string; points: 1 | 2 }[] = [
  { kind: 'trend', label: 'Trend line', glyph: '╱', points: 2 },
  { kind: 'horizontal', label: 'Horizontal line', glyph: '─', points: 1 },
  { kind: 'ray', label: 'Ray', glyph: '→', points: 2 },
  { kind: 'vertical', label: 'Vertical line', glyph: '│', points: 1 },
  { kind: 'rect', label: 'Rectangle', glyph: '▭', points: 2 },
  { kind: 'fib', label: 'Fibonacci retracement', glyph: '≡', points: 2 },
  { kind: 'text', label: 'Text note', glyph: 'T', points: 1 },
];

export const TOOL_BY_KIND = new Map(DRAWING_TOOLS.map((tool) => [tool.kind, tool]));

/** The retracement levels, as every charting package draws them. */
export const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

/** How close a click has to be to count as hitting a shape, in pixels. */
export const HIT_SLOP = 6;

export interface Screen {
  /** Where a time lands on the x axis, in CSS pixels. */
  x: (time: number) => number;
  /** Where a price lands on the y axis. */
  y: (price: number) => number;
  /** And back again, for turning a drag into data. */
  time: (x: number) => number;
  price: (y: number) => number;
  width: number;
  height: number;
}

/** The pixel distance from a point to a line segment. */
export function distanceToSegment(
  point: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point.x - a.x, point.y - a.y);

  // how far along the segment the nearest point is, clamped to its ends
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

/** Whether a click at these pixels lands on this drawing. */
export function hits(drawing: Drawing, at: { x: number; y: number }, screen: Screen): boolean {
  const points = drawing.points.map((point) => ({ x: screen.x(point.time), y: screen.y(point.price) }));
  const [first, second] = points;
  if (!first) return false;

  switch (drawing.kind) {
    case 'horizontal':
      return Math.abs(at.y - first.y) <= HIT_SLOP;
    case 'vertical':
      return Math.abs(at.x - first.x) <= HIT_SLOP;
    case 'text':
      // the label sits up and to the right of its anchor
      return at.x >= first.x - HIT_SLOP && at.x <= first.x + 140 && Math.abs(at.y - first.y) <= 12;
    case 'trend':
      return !!second && distanceToSegment(at, first, second) <= HIT_SLOP;
    case 'ray': {
      if (!second) return false;
      // a ray carries on past its second point, to the edge of the plot
      const far = extend(first, second, screen.width);
      return distanceToSegment(at, first, far) <= HIT_SLOP;
    }
    case 'rect':
    case 'fib': {
      if (!second) return false;
      const left = Math.min(first.x, second.x);
      const right = Math.max(first.x, second.x);
      const top = Math.min(first.y, second.y);
      const bottom = Math.max(first.y, second.y);
      const insideX = at.x >= left - HIT_SLOP && at.x <= right + HIT_SLOP;
      const insideY = at.y >= top - HIT_SLOP && at.y <= bottom + HIT_SLOP;
      if (drawing.kind === 'fib') return insideX && insideY;
      // a rectangle is clicked by its edges, so it can be drawn over candles
      const onEdge =
        Math.abs(at.x - left) <= HIT_SLOP ||
        Math.abs(at.x - right) <= HIT_SLOP ||
        Math.abs(at.y - top) <= HIT_SLOP ||
        Math.abs(at.y - bottom) <= HIT_SLOP;
      return insideX && insideY && onEdge;
    }
    default:
      return false;
  }
}

/** Continues a line beyond its second point, out to `width`. */
export function extend(
  a: { x: number; y: number },
  b: { x: number; y: number },
  width: number,
): { x: number; y: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0) return { x: b.x, y: dy >= 0 ? 1e5 : -1e5 };
  const scale = ((dx > 0 ? width + 50 : -50) - a.x) / dx;
  return { x: a.x + dx * scale, y: a.y + dy * scale };
}

/** The handle a click has grabbed, if any: 0 or 1 for an end, 'body' to move. */
export function handleAt(
  drawing: Drawing,
  at: { x: number; y: number },
  screen: Screen,
): number | 'body' | 'select' | null {
  // a locked drawing can still be picked up in the sense of being *selected* —
  // otherwise it could never be unlocked again — but nothing about it moves
  if (drawing.locked) return hits(drawing, at, screen) ? 'select' : null;
  for (const [index, point] of drawing.points.entries()) {
    const x = screen.x(point.time);
    const y = screen.y(point.price);
    const near =
      drawing.kind === 'horizontal'
        ? Math.abs(at.y - y) <= HIT_SLOP && Math.abs(at.x - x) <= HIT_SLOP * 2
        : drawing.kind === 'vertical'
          ? Math.abs(at.x - x) <= HIT_SLOP && Math.abs(at.y - y) <= HIT_SLOP * 2
          : Math.hypot(at.x - x, at.y - y) <= HIT_SLOP * 1.5;
    if (near) return index;
  }
  return hits(drawing, at, screen) ? 'body' : null;
}

/** Moves one end of a drawing to where the pointer is. */
export function moveHandle(drawing: Drawing, index: number, to: Point): Drawing {
  const points = drawing.points.map((point, at) => (at === index ? to : point));
  return { ...drawing, points };
}

/** Moves the whole drawing by a delta in data space. */
export function moveBy(drawing: Drawing, delta: { time: number; price: number }): Drawing {
  return {
    ...drawing,
    points: drawing.points.map((point) => ({
      time: point.time + delta.time,
      price: point.price + delta.price,
    })),
  };
}

/** The price at each Fibonacci level between two points. */
export function fibLevels(from: Point, to: Point): { ratio: number; price: number }[] {
  const span = to.price - from.price;
  return FIB_LEVELS.map((ratio) => ({ ratio, price: to.price - span * ratio }));
}

/** A new drawing from the tool and the drag that made it. */
export function create(
  kind: DrawingKind,
  from: Point,
  to: Point,
  options: { color: string; id: string; text?: string },
): Drawing {
  const single = TOOL_BY_KIND.get(kind)?.points === 1;
  return {
    id: options.id,
    kind,
    points: single ? [from] : [from, to],
    color: options.color,
    ...(kind === 'text' ? { text: options.text ?? 'Note' } : {}),
  };
}

/** Whether a drag is long enough to have been meant as a shape. */
export function isMeaningful(kind: DrawingKind, from: Point, to: Point, screen: Screen): boolean {
  if (TOOL_BY_KIND.get(kind)?.points === 1) return true;
  const distance = Math.hypot(
    screen.x(to.time) - screen.x(from.time),
    screen.y(to.price) - screen.y(from.price),
  );
  return distance >= 8;
}

/** Keeps a stored set sane: known kinds, capped, with points that are numbers. */
export function sanitise(stored: unknown, limit = 60): Drawing[] {
  if (!Array.isArray(stored)) return [];
  const out: Drawing[] = [];
  for (const each of stored) {
    if (!each || typeof each !== 'object') continue;
    const drawing = each as Partial<Drawing>;
    if (!drawing.id || !drawing.kind || !TOOL_BY_KIND.has(drawing.kind)) continue;
    const points = Array.isArray(drawing.points)
      ? drawing.points.filter(
          (point): point is Point => !!point && Number.isFinite(point.time) && Number.isFinite(point.price),
        )
      : [];
    const wanted = TOOL_BY_KIND.get(drawing.kind)!.points;
    if (points.length < wanted) continue;
    out.push({
      id: String(drawing.id),
      kind: drawing.kind,
      points: points.slice(0, wanted),
      color: typeof drawing.color === 'string' && drawing.color ? drawing.color : '#f6c445',
      locked: drawing.locked === true,
      ...(drawing.kind === 'text' ? { text: String(drawing.text ?? 'Note').slice(0, 80) } : {}),
    });
    if (out.length >= limit) break;
  }
  return out;
}
