import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { forbidden, serviceUnavailable, unauthorized } from '../lib/errors.js';
import { verifyAccessToken } from '../lib/jwt.js';
import { prisma } from '../lib/prisma.js';
import { settings } from '../services/settings.js';
import { isSessionRevoked } from '../services/revocations.js';
import { type AdminRole, type PermissionArea, hasPermission } from '../lib/permissions.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: {
        id: string;
        role: string;
        email: string;
        sessionId?: string;
        /** Set by `requireAdmin`, once it has confirmed the account is staff. */
        adminRole?: AdminRole | null;
      };
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

/**
 * Confirms the account is staff, then requires a second factor before letting
 * it any further in — checked here, live, rather than cached in the access
 * token, so turning 2FA off (or a role change) takes effect on the very next
 * request instead of waiting out the token's lifetime, the same reasoning
 * `requireActiveUser` already follows for suspension.
 */
export const requireAdmin: RequestHandler = (req, _res, next) => {
  if (!req.user) return next(unauthorized());
  prisma.user
    .findUnique({
      where: { id: req.user.id },
      select: { role: true, adminRole: true, twoFactorEnabledAt: true },
    })
    .then((user) => {
      if (!user || user.role !== 'ADMIN') return next(forbidden('Administrator access required'));
      if (!user.twoFactorEnabledAt) {
        return next(
          forbidden(
            'Two-factor authentication is required for admin accounts. Turn it on in Account → Security.',
            'admin_2fa_required',
          ),
        );
      }
      req.user!.adminRole = user.adminRole as AdminRole | null;
      next();
    })
    .catch(next);
};

/** Blocks a route unless the signed-in admin's role holds this area. */
export function requirePermission(area: PermissionArea): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) return next(unauthorized());
    if (!hasPermission(req.user.adminRole, area)) {
      return next(forbidden("You don't have permission for this.", 'insufficient_permission'));
    }
    next();
  };
}

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

/**
 * Blocks new trades and payments while an operator has maintenance mode on.
 * An admin, or a request from an allowlisted IP (for an ops team testing the
 * platform before it reopens), goes through as normal. Read-only routes and
 * a trader backing out of something already in flight (cancelling a pending
 * order or a withdrawal) are never gated here — this is only where new
 * money-moving or trading commitments are made.
 */
export const requireNotInMaintenance: RequestHandler = (req, _res, next) => {
  if (!settings.get('general.maintenanceMode')) return next();
  if (req.user?.role === 'ADMIN') return next();
  const allowlist = settings.get('general.maintenanceAllowlist');
  if (req.ip && allowlist.includes(req.ip)) return next();
  next(serviceUnavailable(settings.get('general.maintenanceMessage'), 'maintenance'));
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
