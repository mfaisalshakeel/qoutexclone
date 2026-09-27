/** Pure JSON-LD builders — no DOM, so they're trivial to unit test. */

export function organizationJsonLd(options: { siteName: string; baseUrl: string; description: string }) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: options.siteName,
    url: options.baseUrl || undefined,
    description: options.description,
  };
}

export function websiteJsonLd(options: { siteName: string; baseUrl: string }) {
  if (!options.baseUrl) {
    return { '@context': 'https://schema.org', '@type': 'WebSite', name: options.siteName };
  }
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: options.siteName,
    url: options.baseUrl,
    potentialAction: {
      '@type': 'SearchAction',
      target: `${options.baseUrl}/help?q={search_term_string}`,
      'query-input': 'required name=search_term_string',
    },
  };
}

export function faqPageJsonLd(entries: { question: string; answer: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: entries.map((entry) => ({
      '@type': 'Question',
      name: entry.question,
      acceptedAnswer: { '@type': 'Answer', text: entry.answer },
    })),
  };
}
