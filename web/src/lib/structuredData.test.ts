import { describe, expect, it } from 'vitest';
import { faqPageJsonLd, organizationJsonLd, websiteJsonLd } from './structuredData';

describe('organizationJsonLd', () => {
  it('builds a real Organization schema', () => {
    const schema = organizationJsonLd({
      siteName: 'Quantex',
      baseUrl: 'https://quantex.example',
      description: 'A trading platform.',
    });
    expect(schema['@type']).toBe('Organization');
    expect(schema.name).toBe('Quantex');
    expect(schema.url).toBe('https://quantex.example');
  });
});

describe('websiteJsonLd', () => {
  it('includes a SearchAction pointed at the help centre when a base URL is known', () => {
    const schema = websiteJsonLd({ siteName: 'Quantex', baseUrl: 'https://quantex.example' });
    expect(schema.potentialAction).toEqual({
      '@type': 'SearchAction',
      target: 'https://quantex.example/help?q={search_term_string}',
      'query-input': 'required name=search_term_string',
    });
  });

  it('omits the SearchAction when no base URL is configured yet', () => {
    const schema = websiteJsonLd({ siteName: 'Quantex', baseUrl: '' });
    expect(schema).not.toHaveProperty('potentialAction');
    expect(schema).not.toHaveProperty('url');
  });
});

describe('faqPageJsonLd', () => {
  it('maps every entry to a Question/Answer pair, in order', () => {
    const schema = faqPageJsonLd([
      { question: 'Q1?', answer: 'A1.' },
      { question: 'Q2?', answer: 'A2.' },
    ]);
    expect(schema.mainEntity).toEqual([
      { '@type': 'Question', name: 'Q1?', acceptedAnswer: { '@type': 'Answer', text: 'A1.' } },
      { '@type': 'Question', name: 'Q2?', acceptedAnswer: { '@type': 'Answer', text: 'A2.' } },
    ]);
  });

  it('produces an empty mainEntity for no entries, never a missing field', () => {
    expect(faqPageJsonLd([]).mainEntity).toEqual([]);
  });
});
