import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  base32Encode,
  generateSecret,
  hotp,
  otpauthUri,
  totp,
  verifyTotp,
} from './totp.js';

/** RFC 4226 and RFC 6238 both use this ASCII secret for their vectors. */
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890', 'ascii'));

describe('base32', () => {
  it('round-trips arbitrary bytes', () => {
    const bytes = Buffer.from([0, 1, 127, 128, 255, 42, 17]);
    expect(base32Decode(base32Encode(bytes))).toEqual(bytes);
  });

  it('encodes the RFC secret the way authenticator apps show it', () => {
    expect(RFC_SECRET).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  });

  it('ignores padding, spacing and case, which is how people type it', () => {
    expect(base32Decode('gezd gnbv gy3t qojq====')).toEqual(base32Decode('GEZDGNBVGY3TQOJQ'));
  });

  it('refuses a character outside the alphabet', () => {
    expect(() => base32Decode('GEZD1')).toThrow();
  });
});

describe('hotp', () => {
  // RFC 4226, appendix D
  const VECTORS = [
    '755224',
    '287082',
    '359152',
    '969429',
    '338314',
    '254676',
    '287922',
    '162583',
    '399871',
    '520489',
  ];

  it('matches the RFC 4226 vectors', () => {
    VECTORS.forEach((expected, counter) => {
      expect(hotp(RFC_SECRET, counter)).toBe(expected);
    });
  });
});

describe('totp', () => {
  // RFC 6238, appendix B (SHA-1 rows), truncated to six digits
  it('matches the RFC 6238 vectors', () => {
    expect(totp(RFC_SECRET, 59_000)).toBe('287082');
    expect(totp(RFC_SECRET, 1_111_111_109_000)).toBe('081804');
    expect(totp(RFC_SECRET, 1_234_567_890_000)).toBe('005924');
  });

  it('holds the same code for the whole 30-second step', () => {
    expect(totp(RFC_SECRET, 60_000)).toBe(totp(RFC_SECRET, 89_999));
    expect(totp(RFC_SECRET, 60_000)).not.toBe(totp(RFC_SECRET, 90_000));
  });
});

describe('verifyTotp', () => {
  const now = 1_700_000_000_000;

  it('accepts the current code', () => {
    expect(verifyTotp(RFC_SECRET, totp(RFC_SECRET, now), now)).toBe(true);
  });

  it('accepts one step either side, for a clock that drifts', () => {
    expect(verifyTotp(RFC_SECRET, totp(RFC_SECRET, now - 30_000), now)).toBe(true);
    expect(verifyTotp(RFC_SECRET, totp(RFC_SECRET, now + 30_000), now)).toBe(true);
  });

  it('rejects a code two steps old', () => {
    expect(verifyTotp(RFC_SECRET, totp(RFC_SECRET, now - 90_000), now)).toBe(false);
  });

  it('rejects anything that is not six digits', () => {
    expect(verifyTotp(RFC_SECRET, '12345', now)).toBe(false);
    expect(verifyTotp(RFC_SECRET, '1234567', now)).toBe(false);
    expect(verifyTotp(RFC_SECRET, 'abcdef', now)).toBe(false);
    expect(verifyTotp(RFC_SECRET, '', now)).toBe(false);
  });

  it('tolerates the spaces an authenticator app puts in the middle', () => {
    const code = totp(RFC_SECRET, now);
    expect(verifyTotp(RFC_SECRET, `${code.slice(0, 3)} ${code.slice(3)}`, now)).toBe(true);
  });
});

describe('secrets and enrolment', () => {
  it('generates a decodable secret of the requested strength', () => {
    const secret = generateSecret();
    expect(base32Decode(secret)).toHaveLength(20);
    expect(generateSecret()).not.toBe(secret);
  });

  it('builds an otpauth URI an app can read', () => {
    const uri = otpauthUri({ secret: 'ABCDEFGH', account: 'trader@example.test', issuer: 'Quantex' });
    expect(uri).toContain('otpauth://totp/Quantex%3Atrader%40example.test?');
    expect(uri).toContain('secret=ABCDEFGH');
    expect(uri).toContain('issuer=Quantex');
    expect(uri).toContain('digits=6');
    expect(uri).toContain('period=30');
  });
});
