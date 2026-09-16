import crypto from 'node:crypto';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../env.js';

export interface AccessPayload {
  sub: string;
  role: string;
  email: string;
}

export function signAccessToken(payload: AccessPayload): string {
  return jwt.sign(payload, env.jwtSecret, { expiresIn: env.accessTokenTtl } as SignOptions);
}

export function verifyAccessToken(token: string): AccessPayload {
  return jwt.verify(token, env.jwtSecret) as AccessPayload;
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
