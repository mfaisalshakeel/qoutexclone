import { describe, expect, it } from 'vitest';
import { parseTableState, sortDirection, sortField, tableStateToParams, toggleSort } from './table-query';

describe('parseTableState', () => {
  it('defaults page to 1 and pageSize to the caller default when absent', () => {
    const state = parseTableState(new URLSearchParams(), 25);
    expect(state).toEqual({ page: 1, pageSize: 25, sort: undefined, search: undefined, filters: {} });
  });

  it('reads page, pageSize, sort and search', () => {
    const state = parseTableState(new URLSearchParams('page=3&pageSize=50&sort=-email&search=alice'), 25);
    expect(state.page).toBe(3);
    expect(state.pageSize).toBe(50);
    expect(state.sort).toBe('-email');
    expect(state.search).toBe('alice');
  });

  it('treats every other param as a filter', () => {
    const state = parseTableState(new URLSearchParams('status=ACTIVE&kycStatus=PENDING'), 25);
    expect(state.filters).toEqual({ status: 'ACTIVE', kycStatus: 'PENDING' });
  });

  it('falls back to defaults on a garbage page or pageSize', () => {
    const state = parseTableState(new URLSearchParams('page=abc&pageSize=-5'), 25);
    expect(state.page).toBe(1);
    expect(state.pageSize).toBe(25);
  });

  it('ignores an empty filter value', () => {
    const state = parseTableState(new URLSearchParams('status='), 25);
    expect(state.filters).toEqual({});
  });
});

describe('tableStateToParams', () => {
  it('omits page when it is 1, so the clean URL has no clutter', () => {
    const params = tableStateToParams({ page: 1, pageSize: 25, filters: {} });
    expect(params.has('page')).toBe(false);
  });

  it('includes page when past the first', () => {
    const params = tableStateToParams({ page: 2, pageSize: 25, filters: {} });
    expect(params.get('page')).toBe('2');
  });

  it('round-trips through parseTableState', () => {
    const original = { page: 4, pageSize: 50, sort: '-createdAt', search: 'bob', filters: { status: 'ACTIVE' } };
    const parsed = parseTableState(tableStateToParams(original), 25);
    expect(parsed).toEqual(original);
  });

  it('drops an empty filter value rather than writing a bare key', () => {
    const params = tableStateToParams({ page: 1, pageSize: 25, filters: { status: '' } });
    expect(params.has('status')).toBe(false);
  });
});

describe('toggleSort', () => {
  it('sorts a fresh column ascending', () => {
    expect(toggleSort(undefined, 'email')).toBe('email');
    expect(toggleSort('name', 'email')).toBe('email');
  });

  it('flips the active ascending column to descending', () => {
    expect(toggleSort('email', 'email')).toBe('-email');
  });

  it('flips the active descending column back to ascending', () => {
    expect(toggleSort('-email', 'email')).toBe('email');
  });
});

describe('sortField / sortDirection', () => {
  it('strips the leading "-" to get the bare field name', () => {
    expect(sortField('-email')).toBe('email');
    expect(sortField('email')).toBe('email');
    expect(sortField(undefined)).toBeUndefined();
  });

  it('reports the direction, or undefined when unsorted', () => {
    expect(sortDirection('-email')).toBe('desc');
    expect(sortDirection('email')).toBe('asc');
    expect(sortDirection(undefined)).toBeUndefined();
  });
});
