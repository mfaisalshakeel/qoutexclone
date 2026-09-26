import { beforeEach, describe, expect, it } from 'vitest';
import { dismiss, loadDismissed } from './announcements';

describe('announcement dismissal', () => {
  beforeEach(() => localStorage.clear());

  it('starts empty', () => {
    expect(loadDismissed()).toEqual([]);
  });

  it('remembers a dismissed id across a reload', () => {
    dismiss('a1');
    expect(loadDismissed()).toEqual(['a1']);
  });

  it('does not duplicate a repeated dismissal', () => {
    dismiss('a1');
    dismiss('a1');
    dismiss('a2');
    expect(loadDismissed().sort()).toEqual(['a1', 'a2']);
  });

  it('ignores corrupted storage rather than throwing', () => {
    localStorage.setItem('quantex.announcements.dismissed', '{not json');
    expect(loadDismissed()).toEqual([]);
  });
});
