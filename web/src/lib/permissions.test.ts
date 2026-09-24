import { describe, expect, it } from 'vitest';
import { hasArea } from './permissions';

describe('hasArea', () => {
  it('is true only when the area is in the list', () => {
    expect(hasArea(['dashboard', 'finance'], 'finance')).toBe(true);
    expect(hasArea(['dashboard', 'finance'], 'risk')).toBe(false);
  });

  it('is false with no permissions at all', () => {
    expect(hasArea(undefined, 'dashboard')).toBe(false);
    expect(hasArea([], 'dashboard')).toBe(false);
  });
});
