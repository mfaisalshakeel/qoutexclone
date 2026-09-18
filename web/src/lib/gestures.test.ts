import { describe, expect, it } from 'vitest';
import { SWIPE_MIN_PX, dragOffset, shouldDismiss, swipeOf, tabAfterSwipe } from './gestures';

const from = { x: 200, y: 400 };

describe('reading a swipe', () => {
  it('names the direction once it is far enough', () => {
    expect(swipeOf(from, { x: 100, y: 400 })).toBe('left');
    expect(swipeOf(from, { x: 300, y: 400 })).toBe('right');
    expect(swipeOf(from, { x: 200, y: 300 })).toBe('up');
    expect(swipeOf(from, { x: 200, y: 500 })).toBe('down');
  });

  it('ignores a tap and a wobble', () => {
    expect(swipeOf(from, { x: 202, y: 403 })).toBeNull();
    expect(swipeOf(from, { x: 200 + SWIPE_MIN_PX - 1, y: 400 })).toBeNull();
    expect(swipeOf(from, { x: 200 + SWIPE_MIN_PX, y: 400 })).toBe('right');
  });

  it('ignores a drag too diagonal to have been meant', () => {
    // 100 across, 100 down: that is a scroll fighting a swipe
    expect(swipeOf(from, { x: 300, y: 500 })).toBeNull();
    // the same distance across with a gentle sag is still a swipe
    expect(swipeOf(from, { x: 300, y: 440 })).toBe('right');
  });

  it('takes a threshold from the caller', () => {
    expect(swipeOf(from, { x: 220, y: 400 }, { min: 10 })).toBe('right');
  });
});

describe('swiping between tabs', () => {
  const tabs = ['open', 'pending', 'closed'] as const;

  it('follows the finger, left for the next one', () => {
    expect(tabAfterSwipe(tabs, 'open', 'left')).toBe('pending');
    expect(tabAfterSwipe(tabs, 'pending', 'left')).toBe('closed');
    expect(tabAfterSwipe(tabs, 'closed', 'right')).toBe('pending');
  });

  it('stops at the ends rather than wrapping round', () => {
    expect(tabAfterSwipe(tabs, 'closed', 'left')).toBe('closed');
    expect(tabAfterSwipe(tabs, 'open', 'right')).toBe('open');
  });

  it('ignores a vertical swipe and an unknown tab', () => {
    expect(tabAfterSwipe(tabs, 'open', 'up')).toBe('open');
    expect(tabAfterSwipe(tabs, 'gone' as 'open', 'left')).toBe('gone');
  });
});

describe('dismissing a sheet', () => {
  it('closes once it has been pulled a third of the way down', () => {
    expect(shouldDismiss({ dragged: 199, height: 600, elapsed: 800 })).toBe(false);
    expect(shouldDismiss({ dragged: 200, height: 600, elapsed: 800 })).toBe(true);
  });

  it('closes on a flick, even a short one', () => {
    // 60px in 100ms is a flick; the same 60px in a second is a fidget
    expect(shouldDismiss({ dragged: 60, height: 600, elapsed: 100 })).toBe(true);
    expect(shouldDismiss({ dragged: 60, height: 600, elapsed: 1_000 })).toBe(false);
  });

  it('never closes on an upward pull', () => {
    expect(shouldDismiss({ dragged: -300, height: 600, elapsed: 100 })).toBe(false);
    expect(shouldDismiss({ dragged: 0, height: 600, elapsed: 100 })).toBe(false);
  });

  it('follows the finger down but not up', () => {
    expect(dragOffset(400, 460)).toBe(60);
    expect(dragOffset(400, 300)).toBe(0);
  });
});
