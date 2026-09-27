import { describe, expect, it } from 'vitest';
import { copyFor } from './Sections';

describe('copyFor', () => {
  it('returns the published copy when the CMS has it, marked as loaded', () => {
    const sections = { hero: { title: 'Real title', subtitle: 'Real subtitle', body: 'Real body' } };
    expect(copyFor(sections, 'hero', 'Fallback')).toEqual({
      title: 'Real title',
      subtitle: 'Real subtitle',
      body: 'Real body',
      loading: false,
    });
  });

  it('falls back to a title-only default when the section has never been published', () => {
    expect(copyFor({}, 'hero', 'Fallback title')).toEqual({
      title: 'Fallback title',
      subtitle: null,
      body: null,
      loading: false,
    });
  });

  it('is marked as still loading before the sections have loaded at all, so a subtitle/body that is about to arrive never pops in without a placeholder', () => {
    expect(copyFor(null, 'hero', 'Fallback title')).toEqual({
      title: 'Fallback title',
      subtitle: null,
      body: null,
      loading: true,
    });
  });
});
