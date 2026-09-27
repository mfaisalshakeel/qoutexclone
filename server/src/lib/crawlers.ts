/**
 * Recognises a search or social-preview crawler by its user agent, so the
 * server can hand it a prerendered snapshot instead of the bare SPA shell it
 * cannot run JavaScript to fill in. This is the same content every visitor
 * eventually sees, rendered ahead of time rather than replaced — dynamic
 * rendering, not cloaking.
 */
const CRAWLER_PATTERNS = [
  /googlebot/i,
  /bingbot/i,
  /slurp/i, // Yahoo
  /duckduckbot/i,
  /baiduspider/i,
  /yandexbot/i,
  /applebot/i,
  /facebookexternalhit/i,
  /twitterbot/i,
  /linkedinbot/i,
  /whatsapp/i,
  /telegrambot/i,
  /slackbot/i,
  /discordbot/i,
  /pinterest/i,
  /ia_archiver/i,
  /semrushbot/i,
  /ahrefsbot/i,
];

export function isCrawlerUserAgent(userAgent: string | undefined | null): boolean {
  if (!userAgent) return false;
  return CRAWLER_PATTERNS.some((pattern) => pattern.test(userAgent));
}
