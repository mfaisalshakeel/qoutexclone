import { describe, expect, it } from 'vitest';
import {
  describeTrigger,
  isExpired,
  priceMet,
  shouldTrigger,
  sideFor,
  type PendingOrder,
} from '../engine/orders.js';

const NOW = Date.parse('2026-09-17T12:00:00Z');
const later = (ms: number) => new Date(NOW + ms);

const priceOrder = (over: Partial<PendingOrder> = {}): PendingOrder => ({
  trigger: 'PRICE',
  triggerPrice: 1.1,
  triggerSide: 'ABOVE',
  goodUntil: later(3_600_000),
  ...over,
});

const timeOrder = (over: Partial<PendingOrder> = {}): PendingOrder => ({
  trigger: 'TIME',
  triggerAt: later(60_000),
  goodUntil: later(3_600_000),
  ...over,
});

describe('which side the level is on', () => {
  it('is decided by the price when the order is placed', () => {
    expect(sideFor(1.2, 1.1)).toBe('ABOVE');
    expect(sideFor(1.0, 1.1)).toBe('BELOW');
  });

  it('refuses a level that is already the price', () => {
    // an order that is true the moment it is placed is a market order
    expect(sideFor(1.1, 1.1)).toBeNull();
  });

  it('refuses nonsense', () => {
    expect(sideFor(0, 1.1)).toBeNull();
    expect(sideFor(-1, 1.1)).toBeNull();
    expect(sideFor(Number.NaN, 1.1)).toBeNull();
    expect(sideFor(1.2, Number.NaN)).toBeNull();
  });
});

describe('meeting a level', () => {
  it('fires on the way up for a level above the market', () => {
    expect(priceMet('ABOVE', 1.1, 1.0999)).toBe(false);
    expect(priceMet('ABOVE', 1.1, 1.1)).toBe(true);
    expect(priceMet('ABOVE', 1.1, 1.2)).toBe(true);
  });

  it('fires on the way down for a level below the market', () => {
    expect(priceMet('BELOW', 1.1, 1.1001)).toBe(false);
    expect(priceMet('BELOW', 1.1, 1.1)).toBe(true);
    expect(priceMet('BELOW', 1.1, 1.0)).toBe(true);
  });

  it('never fires without a side, rather than guessing one', () => {
    // this is why the side is stored: after the price has crossed and come
    // back, re-deriving it would give the wrong answer
    expect(priceMet(null, 1.1, 1.2)).toBe(false);
    expect(priceMet('SIDEWAYS', 1.1, 1.2)).toBe(false);
  });
});

describe('when an order fires', () => {
  it('fires a price order once the level is met', () => {
    expect(shouldTrigger(priceOrder(), { price: 1.0, now: NOW })).toBe(false);
    expect(shouldTrigger(priceOrder(), { price: 1.15, now: NOW })).toBe(true);
  });

  it('waits when the market has no price', () => {
    expect(shouldTrigger(priceOrder(), { price: null, now: NOW })).toBe(false);
    expect(shouldTrigger(priceOrder(), { now: NOW })).toBe(false);
  });

  it('fires a time order when its moment arrives', () => {
    expect(shouldTrigger(timeOrder(), { now: NOW })).toBe(false);
    expect(shouldTrigger(timeOrder(), { now: NOW + 60_000 })).toBe(true);
    expect(shouldTrigger(timeOrder(), { now: NOW + 61_000 })).toBe(true);
  });

  it('ignores the price for a time order and the clock for a price order', () => {
    expect(shouldTrigger(timeOrder(), { price: 99, now: NOW })).toBe(false);
    expect(shouldTrigger(priceOrder(), { price: 1.0, now: NOW + 60_000 })).toBe(false);
  });

  it('never fires once it has run out of time', () => {
    const stale = priceOrder({ goodUntil: later(-1) });
    expect(shouldTrigger(stale, { price: 1.5, now: NOW })).toBe(false);
    expect(isExpired(stale, NOW)).toBe(true);
  });

  it('treats a time order whose window closed first as expired, not due', () => {
    // good until 12:30 but asked to open at 13:00: it can never fire
    const impossible = timeOrder({ triggerAt: later(3_600_000), goodUntil: later(1_800_000) });
    expect(shouldTrigger(impossible, { now: NOW + 3_600_000 })).toBe(false);
    expect(isExpired(impossible, NOW + 3_600_000)).toBe(true);
  });

  it('is still live right up to its deadline', () => {
    const order = priceOrder({ goodUntil: later(1_000) });
    expect(isExpired(order, NOW + 999)).toBe(false);
    expect(isExpired(order, NOW + 1_000)).toBe(true);
  });
});

describe('describing the condition', () => {
  it('reads the way a trader would say it', () => {
    expect(describeTrigger(priceOrder())).toBe('at or above 1.1');
    expect(describeTrigger(priceOrder({ triggerSide: 'BELOW' }))).toBe('at or below 1.1');
    expect(describeTrigger(timeOrder())).toContain('2026-09-17T12:01:00');
  });

  it('says something sensible when a field is missing', () => {
    expect(describeTrigger(priceOrder({ triggerPrice: null }))).toBe('at a price');
    expect(describeTrigger(timeOrder({ triggerAt: null }))).toBe('at a time');
  });
});
