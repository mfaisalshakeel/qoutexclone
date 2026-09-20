import { describe, expect, it } from 'vitest';
import { strength } from './password';

describe('strength', () => {
  it('calls an empty field too short and says what to do', () => {
    expect(strength('')).toEqual({ score: 0, label: 'Too short', hint: 'Use at least 8 characters' });
  });

  it('climbs with length and with variety', () => {
    const short = strength('Ab1x');
    const eight = strength('Ab1xQp7z');
    const long = strength('Ab1xQp7zRt4m');
    expect(short.score).toBeLessThan(eight.score);
    expect(eight.score).toBeLessThan(long.score);
  });

  it('calls a long mixed password strong', () => {
    expect(strength('Harbour7Lantern!Quay').label).toBe('Strong');
  });

  it('docks a point for a keyboard run or a repeat', () => {
    expect(strength('Abcdefgh12').score).toBeLessThan(strength('Kqmwzrth12').score);
    expect(strength('Aaaaaaaa12').score).toBeLessThan(strength('Kqmwzrth12').score);
  });

  it('caps a password that contains the name or the address on the account', () => {
    const weak = strength('Trader7Harbour!Quay', { email: 'trader@example.test' });
    expect(weak.score).toBeLessThanOrEqual(1);
    expect(weak.hint).toBe('Leave your name and email out of it');
    expect(strength('Amelia7Harbour!Quay', { name: 'Amelia Stone' }).score).toBeLessThanOrEqual(1);
  });

  it('ignores a short email local part, which would match almost anything', () => {
    expect(strength('Harbour7Lantern!Quay', { email: 'ab@example.test' }).label).toBe('Strong');
  });

  it('gives one hint at a time, and none once the password is strong', () => {
    expect(strength('short').hint).toBe('Use at least 8 characters');
    expect(strength('lowercaseonly').hint).toBe('Mix upper case, lower case and numbers');
    expect(strength('Ab1xQp7z').hint).toBe('Longer is stronger — aim for 12 or more');
    expect(strength('Harbour7Lantern!Quay').hint).toBeNull();
  });
});
