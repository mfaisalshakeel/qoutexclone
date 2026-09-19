import { describe, expect, it } from 'vitest';
import {
  FIB_LEVELS,
  create,
  distanceToSegment,
  extend,
  fibLevels,
  handleAt,
  hits,
  isMeaningful,
  moveBy,
  moveHandle,
  sanitise,
  type Drawing,
  type Screen,
} from './drawings';

/** A plot 800×400 where one second is one pixel and one price point is one. */
const screen: Screen = {
  x: (time) => time - 1_000,
  y: (price) => 400 - (price - 100),
  time: (x) => x + 1_000,
  price: (y) => 100 + (400 - y),
  width: 800,
  height: 400,
};

const trend: Drawing = {
  id: 'a',
  kind: 'trend',
  points: [
    { time: 1_100, price: 200 },
    { time: 1_300, price: 300 },
  ],
  color: '#fff',
};

describe('hitting a drawing', () => {
  it('measures the distance to a segment, including past its ends', () => {
    expect(distanceToSegment({ x: 5, y: 5 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(5);
    expect(distanceToSegment({ x: 20, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(10);
    expect(distanceToSegment({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 })).toBe(5);
  });

  it('lands on a trend line only near the line itself', () => {
    const on = { x: screen.x(1_200), y: screen.y(250) };
    expect(hits(trend, on, screen)).toBe(true);
    expect(hits(trend, { x: on.x, y: on.y + 40 }, screen)).toBe(false);
    // and not on the line's continuation, because a trend line has two ends
    expect(hits(trend, { x: screen.x(1_500), y: screen.y(400) }, screen)).toBe(false);
  });

  it('lands anywhere along a horizontal line and a vertical one', () => {
    const horizontal: Drawing = {
      id: 'h',
      kind: 'horizontal',
      points: [{ time: 1_100, price: 250 }],
      color: '#fff',
    };
    expect(hits(horizontal, { x: 700, y: screen.y(250) }, screen)).toBe(true);
    expect(hits(horizontal, { x: 700, y: screen.y(260) }, screen)).toBe(false);

    const vertical: Drawing = {
      id: 'v',
      kind: 'vertical',
      points: [{ time: 1_200, price: 250 }],
      color: '#fff',
    };
    expect(hits(vertical, { x: screen.x(1_200), y: 10 }, screen)).toBe(true);
    expect(hits(vertical, { x: screen.x(1_260), y: 10 }, screen)).toBe(false);
  });

  it('carries a ray past its second point', () => {
    const ray: Drawing = { ...trend, kind: 'ray' };
    // on the continuation of the same slope, well past the second point
    expect(hits(ray, { x: screen.x(1_500), y: screen.y(400) }, screen)).toBe(true);
    expect(hits(ray, { x: screen.x(1_500), y: screen.y(200) }, screen)).toBe(false);
  });

  it('extends a line to the edge of the plot rather than a fixed length', () => {
    const far = extend({ x: 0, y: 0 }, { x: 10, y: 10 }, 800);
    expect(far.x).toBeGreaterThan(800);
    expect(far.y).toBeCloseTo(far.x, 6);
    // straight up is a special case that must not divide by zero
    expect(Number.isFinite(extend({ x: 5, y: 0 }, { x: 5, y: 10 }, 800).y)).toBe(true);
  });

  it('clicks a rectangle by its edge, not by its middle', () => {
    const rect: Drawing = { ...trend, kind: 'rect' };
    const left = screen.x(1_100);
    const top = screen.y(300);
    expect(hits(rect, { x: left, y: top + 20 }, screen)).toBe(true);
    expect(hits(rect, { x: left + 60, y: top + 20 }, screen)).toBe(false);
  });

  it('clicks a Fibonacci anywhere inside it, because that is where its levels are', () => {
    const fib: Drawing = { ...trend, kind: 'fib' };
    expect(hits(fib, { x: screen.x(1_200), y: screen.y(250) }, screen)).toBe(true);
    expect(hits(fib, { x: screen.x(1_400), y: screen.y(250) }, screen)).toBe(false);
  });
});

describe('handles', () => {
  it('grabs an end when the click is on one, and the body otherwise', () => {
    expect(handleAt(trend, { x: screen.x(1_100), y: screen.y(200) }, screen)).toBe(0);
    expect(handleAt(trend, { x: screen.x(1_300), y: screen.y(300) }, screen)).toBe(1);
    expect(handleAt(trend, { x: screen.x(1_200), y: screen.y(250) }, screen)).toBe('body');
    expect(handleAt(trend, { x: 10, y: 10 }, screen)).toBeNull();
  });

  it('lets a locked drawing be selected but never moved', () => {
    const locked = { ...trend, locked: true };
    // on the line: selectable, so it can be unlocked again
    expect(handleAt(locked, { x: screen.x(1_200), y: screen.y(250) }, screen)).toBe('select');
    // even on a handle, which would otherwise be a resize
    expect(handleAt(locked, { x: screen.x(1_100), y: screen.y(200) }, screen)).toBe('select');
    // and nowhere near it, nothing
    expect(handleAt(locked, { x: 10, y: 10 }, screen)).toBeNull();
  });

  it('moves one end without touching the other', () => {
    const moved = moveHandle(trend, 1, { time: 1_400, price: 350 });
    expect(moved.points[0]).toEqual(trend.points[0]);
    expect(moved.points[1]).toEqual({ time: 1_400, price: 350 });
  });

  it('moves the whole shape by a delta in data space', () => {
    const moved = moveBy(trend, { time: 100, price: -50 });
    expect(moved.points).toEqual([
      { time: 1_200, price: 150 },
      { time: 1_400, price: 250 },
    ]);
  });
});

describe('Fibonacci retracement', () => {
  it('runs from the second point back to the first', () => {
    const levels = fibLevels({ time: 1_100, price: 100 }, { time: 1_300, price: 200 });
    expect(levels).toHaveLength(FIB_LEVELS.length);
    expect(levels[0]).toEqual({ ratio: 0, price: 200 });
    expect(levels.at(-1)).toEqual({ ratio: 1, price: 100 });
    // the golden one sits 61.8% of the way back
    expect(levels.find((level) => level.ratio === 0.618)!.price).toBeCloseTo(138.2, 6);
  });

  it('works the same way on a fall as on a rise', () => {
    const levels = fibLevels({ time: 1_100, price: 200 }, { time: 1_300, price: 100 });
    expect(levels[0].price).toBe(100);
    expect(levels.at(-1)!.price).toBe(200);
  });
});

describe('making one', () => {
  const from = { time: 1_100, price: 200 };
  const to = { time: 1_300, price: 300 };

  it('keeps one point for the shapes that only have one', () => {
    expect(create('horizontal', from, to, { color: '#fff', id: '1' }).points).toEqual([from]);
    expect(create('trend', from, to, { color: '#fff', id: '1' }).points).toEqual([from, to]);
  });

  it('gives a text note something to say', () => {
    expect(create('text', from, to, { color: '#fff', id: '1' }).text).toBe('Note');
  });

  it('ignores a two-point drag too short to have been meant', () => {
    expect(isMeaningful('trend', from, { time: 1_101, price: 200 }, screen)).toBe(false);
    expect(isMeaningful('trend', from, to, screen)).toBe(true);
    // a one-point shape is a click, so it is always meant
    expect(isMeaningful('horizontal', from, from, screen)).toBe(true);
  });
});

describe('reading a stored set', () => {
  it('drops anything it does not recognise', () => {
    const cleaned = sanitise([
      trend,
      { id: 'x', kind: 'wormhole', points: [{ time: 1, price: 2 }] },
      { id: 'y', kind: 'trend', points: [{ time: 1, price: 2 }] },
      {
        id: 'z',
        kind: 'trend',
        points: [
          { time: 1, price: NaN },
          { time: 2, price: 3 },
        ],
      },
      null,
      'nonsense',
    ]);
    expect(cleaned.map((each) => each.id)).toEqual(['a']);
  });

  it('fills in a missing colour and clamps a runaway list', () => {
    const many = Array.from({ length: 200 }, (_, index) => ({ ...trend, id: `t${index}`, color: undefined }));
    const cleaned = sanitise(many, 60);
    expect(cleaned).toHaveLength(60);
    expect(cleaned[0].color).toMatch(/^#/);
  });

  it('never throws on rubbish', () => {
    expect(sanitise(null)).toEqual([]);
    expect(sanitise({ nope: true })).toEqual([]);
    expect(
      sanitise([{ id: 'a', kind: 'text', points: [{ time: 1, price: 2 }], text: 'x'.repeat(500) }])[0].text,
    ).toHaveLength(80);
  });
});
