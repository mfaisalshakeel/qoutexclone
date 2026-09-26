import { describe, expect, it } from 'vitest';
import { copyFor } from './Sections';

describe('copyFor', () => {
  it('returns the published copy when the CMS has it', () => {
    const sections = { hero: { title: 'Real title', subtitle: 'Real subtitle', body: 'Real body' } };
    expect(copyFor(sections, 'hero', 'Fallback')).toEqual({
      title: 'Real title',
      subtitle: 'Real subtitle',
      body: 'Real body',
    });
  });

  it('falls back to a title-only default when the section has never been published', () => {
    expect(copyFor({}, 'hero', 'Fallback title')).toEqual({
      title: 'Fallback title',
      subtitle: null,
      body: null,
    });
  });

  it('falls back the same way before the sections have loaded at all', () => {
    expect(copyFor(null, 'hero', 'Fallback title')).toEqual({
      title: 'Fallback title',
      subtitle: null,
      body: null,
    });
  });
});
