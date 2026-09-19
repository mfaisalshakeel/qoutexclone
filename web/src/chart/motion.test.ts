import { describe, expect, it } from 'vitest';
import { gapBetween, glide, pinchFactor, scaleRange, shiftRange, velocityOf } from './motion';

const plot = { width: 800, height: 400 };

describe('a flick', () => {
  it('is the speed of the last leg of the drag', () => {
    expect(velocityOf(100, 100)).toBeCloseTo(1, 9);
    expect(velocityOf(-50, 100)).toBeCloseTo(-0.5, 9);
  });

  it('cannot be thrown faster than the chart can follow', () => {
    expect(velocityOf(10_000, 1)).toBeLessThanOrEqual(6);
    expect(velocityOf(-10_000, 1)).toBeGreaterThanOrEqual(-6);
  });

  it('survives a zero-length gesture without dividing by zero', () => {
    expect(velocityOf(10, 0)).toBe(0);
  });

  it('slows down every frame and eventually stops', () => {
    let velocity = 2;
    let frames = 0;
    let travelled = 0;
    for (;;) {
      const step = glide(velocity, 16.67);
      if (!step) break;
      expect(Math.abs(step.velocity)).toBeLessThan(Math.abs(velocity));
      velocity = step.velocity;
      travelled += step.dxPx;
      frames += 1;
      if (frames > 1_000) break;
    }
    // about half a second of glide, and a finite distance
    expect(frames).toBeGreaterThan(20);
    expect(frames).toBeLessThan(90);
    expect(travelled).toBeGreaterThan(0);
  });

  it('stops immediately when there was barely any movement', () => {
    expect(glide(0.01, 16.67)).toBeNull();
  });
});

describe('a pinch', () => {
  it('zooms in as the fingers spread', () => {
    expect(pinchFactor(100, 200)).toBeCloseTo(0.5, 9);
    expect(pinchFactor(200, 100)).toBeCloseTo(2, 9);
    expect(pinchFactor(100, 100)).toBe(1);
  });

  it('is bounded, and survives fingers landing in the same spot', () => {
    expect(pinchFactor(1, 10_000)).toBeGreaterThanOrEqual(0.2);
    expect(pinchFactor(10_000, 1)).toBeLessThanOrEqual(5);
    expect(pinchFactor(0, 50)).toBe(1);
  });

  it('measures the gap between two fingers', () => {
    expect(gapBetween({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });
});

describe('dragging the price axis', () => {
  const range = { min: 100, max: 200 };

  it('moves the range with the finger, in price rather than pixels', () => {
    // dragging down by a tenth of the plot moves the range by a tenth of its span
    expect(shiftRange(range, 40, plot)).toEqual({ min: 110, max: 210 });
    expect(shiftRange(range, -40, plot)).toEqual({ min: 90, max: 190 });
  });

  it('stretches about the middle, so the centre price stays put', () => {
    const stretched = scaleRange(range, 2);
    expect((stretched.min + stretched.max) / 2).toBeCloseTo(150, 9);
    expect(stretched.max - stretched.min).toBeCloseTo(200, 9);
  });

  it('cannot be collapsed to nothing or blown up to infinity', () => {
    expect(scaleRange(range, 0).max - scaleRange(range, 0).min).toBeGreaterThan(0);
    expect(scaleRange(range, 1e9).max).toBeLessThan(Infinity);
  });
});
