import crypto from 'node:crypto';

/**
 * What a session is being used from.
 *
 * A user agent is not identity, and it is not meant to be: the point is a
 * label a trader recognises in a device list ("Chrome on Windows") and a
 * stable-enough key to tell a familiar sign-in from a new one.
 */

const BROWSERS: [RegExp, string][] = [
  [/\bEdg(?:e|A|iOS)?\//, 'Edge'],
  [/\bOPR\/|\bOpera\b/, 'Opera'],
  [/\bSamsungBrowser\//, 'Samsung Internet'],
  [/\bFirefox\/|\bFxiOS\//, 'Firefox'],
  [/\bCriOS\//, 'Chrome'],
  [/\bChrome\//, 'Chrome'],
  [/\bSafari\//, 'Safari'],
];

const PLATFORMS: [RegExp, string][] = [
  [/\bWindows NT\b/, 'Windows'],
  [/\b(iPhone|iPod)\b/, 'iPhone'],
  [/\biPad\b/, 'iPad'],
  [/\bAndroid\b/, 'Android'],
  [/\bMac OS X\b|\bMacintosh\b/, 'macOS'],
  [/\bCrOS\b/, 'ChromeOS'],
  [/\bLinux\b/, 'Linux'],
];

function match(pairs: [RegExp, string][], agent: string): string | null {
  for (const [pattern, name] of pairs) if (pattern.test(agent)) return name;
  return null;
}

/** A short label for a device list. Never empty. */
export function describeDevice(userAgent: string | undefined | null): string {
  const agent = (userAgent ?? '').trim();
  if (!agent) return 'Unknown device';
  const browser = match(BROWSERS, agent);
  const platform = match(PLATFORMS, agent);
  if (browser && platform) return `${browser} on ${platform}`;
  if (browser) return browser;
  if (platform) return platform;
  return 'Unknown device';
}

/**
 * The network an address belongs to, rather than the address itself.
 *
 * A phone changes IP constantly inside the same network; keying a device on
 * the full address would call every sign-in new. IPv4 keeps three octets,
 * IPv6 keeps its routing prefix.
 */
export function networkOf(ip: string | undefined | null): string {
  const address = (ip ?? '').trim().replace(/^::ffff:/, '');
  if (!address) return 'unknown';
  if (address.includes(':')) return address.split(':').slice(0, 4).join(':');
  const octets = address.split('.');
  return octets.length === 4 ? `${octets[0]}.${octets[1]}.${octets[2]}.0` : address;
}

/**
 * A stable key for "this browser, from around here".
 *
 * Hashed so the device list and the login history do not become a second copy
 * of everyone's address history in plain text.
 */
export function fingerprint(options: { userAgent?: string | null; ip?: string | null }): string {
  const label = describeDevice(options.userAgent);
  return crypto
    .createHash('sha256')
    .update(`${label}|${networkOf(options.ip)}`)
    .digest('hex')
    .slice(0, 32);
}

/** The caller's address, honouring a proxy only when Express says to. */
export function addressOf(request: { ip?: string; socket?: { remoteAddress?: string } }): string {
  return (request.ip ?? request.socket?.remoteAddress ?? '').replace(/^::ffff:/, '') || 'unknown';
}
