import { describe, expect, it } from 'vitest';
import en from './locales/en.json';
import ar from './locales/ar.json';

/** Recursively collects every leaf key path (e.g. "home.hero.title") so the two
 *  catalogues can be diffed key-for-key rather than just deep-equal-checked —
 *  a deep-equal failure doesn't say which key is missing. */
function leafPaths(node: unknown, prefix = ''): string[] {
  if (typeof node === 'string') return [prefix];
  if (node && typeof node === 'object') {
    return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
      leafPaths(value, prefix ? `${prefix}.${key}` : key),
    );
  }
  return [];
}

describe('translation catalogues', () => {
  it('have exactly the same set of keys in English and Arabic', () => {
    const enKeys = new Set(leafPaths(en));
    const arKeys = new Set(leafPaths(ar));

    const missingFromAr = [...enKeys].filter((k) => !arKeys.has(k)).sort();
    const missingFromEn = [...arKeys].filter((k) => !enKeys.has(k)).sort();

    expect(missingFromAr, 'keys present in en.json but missing from ar.json').toEqual([]);
    expect(missingFromEn, 'keys present in ar.json but missing from en.json').toEqual([]);
  });

  it('never ships an empty string as a translation', () => {
    for (const [name, catalogue] of [
      ['en', en],
      ['ar', ar],
    ] as const) {
      const empty = leafPaths(catalogue).filter((path) => {
        const value = path
          .split('.')
          .reduce<unknown>((obj, key) => (obj as Record<string, unknown>)[key], catalogue);
        return typeof value === 'string' && value.trim() === '';
      });
      expect(empty, `empty values in ${name}.json`).toEqual([]);
    }
  });
});
