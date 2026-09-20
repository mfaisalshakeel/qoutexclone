import crypto from 'node:crypto';

/**
 * Time-based one-time passwords (RFC 6238) over HOTP (RFC 4226).
 *
 * Implemented here rather than pulled in: it is forty lines of arithmetic on a
 * HMAC, and the parts worth getting right — the base32 alphabet, the dynamic
 * truncation, the window either side of now — are exactly the parts a unit
 * test can pin down.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;

/** How many steps either side of now a code is still accepted. */
export const TOTP_WINDOW = 1;

export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/=+$/, '').replace(/\s+/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const character of clean) {
    const index = ALPHABET.indexOf(character);
    if (index === -1) throw new Error(`not base32: ${character}`);
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A fresh shared secret, in the base32 an authenticator app expects. */
export function generateSecret(bytes = 20): string {
  return base32Encode(crypto.randomBytes(bytes));
}

/** The counter-based code behind TOTP. */
export function hotp(secret: string, counter: number, digits = TOTP_DIGITS): string {
  const buffer = Buffer.alloc(8);
  // the counter is 64-bit; JavaScript numbers are safe well past any step we
  // will ever see, so it is written as two 32-bit halves
  buffer.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buffer.writeUInt32BE(counter >>> 0, 4);

  const digest = crypto.createHmac('sha1', base32Decode(secret)).update(buffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const code =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(code % 10 ** digits).padStart(digits, '0');
}

export function totp(secret: string, atMs = Date.now(), digits = TOTP_DIGITS): string {
  return hotp(secret, Math.floor(atMs / 1000 / TOTP_STEP_SECONDS), digits);
}

/**
 * Whether a code is valid now, allowing for a clock that drifts.
 *
 * Compared in constant time so a wrong code cannot be narrowed down by how
 * long the answer took.
 */
export function verifyTotp(secret: string, code: string, atMs = Date.now(), window = TOTP_WINDOW): boolean {
  const given = code.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(given)) return false;
  const step = Math.floor(atMs / 1000 / TOTP_STEP_SECONDS);
  let ok = false;
  for (let offset = -window; offset <= window; offset += 1) {
    const expected = hotp(secret, step + offset);
    // every step is checked, and the loop never breaks early: same work either way
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(given))) ok = true;
  }
  return ok;
}

/** The `otpauth://` URI an authenticator app reads out of a QR code. */
export function otpauthUri(options: { secret: string; account: string; issuer: string }): string {
  const label = encodeURIComponent(`${options.issuer}:${options.account}`);
  const query = new URLSearchParams({
    secret: options.secret,
    issuer: options.issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${query.toString()}`;
}
