import crypto from 'node:crypto';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../env.js';

export interface AccessPayload {
  sub: string;
  role: string;
  email: string;
  /** The session this token was minted for, so a device list can mark it. */
  sid?: string;
}

export function signAccessToken(payload: AccessPayload): string {
  return jwt.sign(payload, env.jwtSecret, { expiresIn: env.accessTokenTtl } as SignOptions);
}

export function verifyAccessToken(token: string): AccessPayload {
  return jwt.verify(token, env.jwtSecret) as AccessPayload;
}

/**
 * The short-lived ticket between "the password was right" and "the code was
 * right". It is not a session: it carries a purpose, so it can never be
 * presented to an endpoint that expects an access token.
 */
const CHALLENGE_TTL_SECONDS = 5 * 60;

export function signChallengeToken(userId: string): string {
  return jwt.sign({ sub: userId, purpose: 'two-factor' }, env.jwtSecret, {
    expiresIn: CHALLENGE_TTL_SECONDS,
  } as SignOptions);
}

/** The user id the challenge was issued for, or null if it is not one. */
export function verifyChallengeToken(token: string): string | null {
  try {
    const payload = jwt.verify(token, env.jwtSecret) as { sub?: string; purpose?: string };
    if (payload.purpose !== 'two-factor' || !payload.sub) return null;
    return payload.sub;
  } catch {
    return null;
  }
}

export function createRefreshToken(): { token: string; hash: string; expiresAt: Date } {
  const token = crypto.randomBytes(48).toString('base64url');
  return {
    token,
    hash: hashRefreshToken(token),
    expiresAt: new Date(Date.now() + env.refreshTokenDays * 24 * 60 * 60 * 1000),
  };
}

export function hashRefreshToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}
