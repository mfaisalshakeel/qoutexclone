import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { forbidden, unauthorized } from '../lib/errors.js';
import { verifyAccessToken } from '../lib/jwt.js';
import { prisma } from '../lib/prisma.js';
import { settings } from '../services/settings.js';
import { isSessionRevoked } from '../services/revocations.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: { id: string; role: string; email: string; sessionId?: string };
    }
  }
}

function readToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7).trim();
  return null;
}

export const requireAuth: RequestHandler = (req, _res, next) => {
  const token = readToken(req);
  if (!token) return next(unauthorized());
  try {
    const payload = verifyAccessToken(token);
    // signing a device out has to bite now, not when its access token expires
    if (payload.sid && isSessionRevoked(payload.sid)) {
      return next(unauthorized('This device was signed out'));
    }
    req.user = { id: payload.sub, role: payload.role, email: payload.email, sessionId: payload.sid };
    next();
  } catch {
    next(unauthorized('Session expired, please sign in again'));
  }
};

/** Populates req.user when a valid token is present but never rejects. */
export const optionalAuth: RequestHandler = (req, _res, next) => {
  const token = readToken(req);
  if (token) {
    try {
      const payload = verifyAccessToken(token);
      if (!payload.sid || !isSessionRevoked(payload.sid)) {
        req.user = { id: payload.sub, role: payload.role, email: payload.email, sessionId: payload.sid };
      }
    } catch {
      /* ignore — treated as anonymous */
    }
  }
  next();
};

export const requireAdmin = (req: Request, _res: Response, next: NextFunction) => {
  if (!req.user) return next(unauthorized());
  if (req.user.role !== 'ADMIN') return next(forbidden('Administrator access required'));
  next();
};

/**
 * Blocks money movement while the address is unproven, when an operator has
 * made verification mandatory. Trading on either account is unaffected: the
 * gate is about money leaving or arriving, not about using the platform.
 */
export const requireVerifiedEmail: RequestHandler = (req, _res, next) => {
  if (!req.user) return next(unauthorized());
  if (settings.get('security.emailVerification') !== 'required') return next();
  prisma.user
    .findUnique({ where: { id: req.user.id }, select: { emailVerifiedAt: true } })
    .then((user) => {
      if (user?.emailVerifiedAt) return next();
      next(forbidden('Confirm your email address before depositing or withdrawing.'));
    })
    .catch(next);
};

/** Blocks suspended accounts from trading or moving money. */
export const requireActiveUser: RequestHandler = (req, _res, next) => {
  if (!req.user) return next(unauthorized());
  prisma.user
    .findUnique({ where: { id: req.user.id }, select: { status: true } })
    .then((user) => {
      if (!user) return next(unauthorized());
      if (user.status !== 'ACTIVE') return next(forbidden('Your account is suspended. Contact support.'));
      next();
    })
    .catch(next);
};
