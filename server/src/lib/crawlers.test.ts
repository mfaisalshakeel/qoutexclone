import { describe, expect, it } from 'vitest';
import { isCrawlerUserAgent } from './crawlers.js';

describe('isCrawlerUserAgent', () => {
  it('recognises the major search and social-preview crawlers', () => {
    const agents = [
      'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
      'facebookexternalhit/1.1',
      'Twitterbot/1.0',
      'LinkedInBot/1.0',
      'Slackbot-LinkExpanding 1.0',
      'WhatsApp/2.23.20.0',
    ];
    for (const agent of agents) expect(isCrawlerUserAgent(agent)).toBe(true);
  });

  it('never matches a real browser', () => {
    const agents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
    ];
    for (const agent of agents) expect(isCrawlerUserAgent(agent)).toBe(false);
  });

  it('treats a missing user agent as not a crawler', () => {
    expect(isCrawlerUserAgent(undefined)).toBe(false);
    expect(isCrawlerUserAgent(null)).toBe(false);
    expect(isCrawlerUserAgent('')).toBe(false);
  });
});
