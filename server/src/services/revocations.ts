import { prisma } from '../lib/prisma.js';
import { log } from '../lib/logger.js';

/**
 * Sessions that have been signed out but whose access token has not expired
 * yet.
 *
 * Revoking a refresh token stops the *next* rotation, which would leave "log
 * out other devices" doing nothing for up to the access token's lifetime —
 * exactly the window that matters when someone is signing a stranger out. So
 * revoked session ids are held here and checked on every request: one lookup
 * in a Map, no database round trip.
 *
 * The set only ever holds ids whose access tokens could still be alive, so it
 * stays small however many devices the platform has. It is rebuilt at boot
 * from the rows revoked inside that same window, because a restart must not
 * quietly un-revoke anything.
 */

/** Comfortably longer than any access token; a stale entry costs nothing. */
const WINDOW_MS = 2 * 60 * 60 * 1000;

const revoked = new Map<string, number>();

export function revokeSessions(ids: string[], at = Date.now()): void {
  for (const id of ids) revoked.set(id, at + WINDOW_MS);
}

export function isSessionRevoked(id: string): boolean {
  const until = revoked.get(id);
  if (until === undefined) return false;
  if (until > Date.now()) return true;
  revoked.delete(id);
  return false;
}

/** Drops entries whose access tokens cannot be alive any more. */
export function pruneRevocations(now = Date.now()): number {
  for (const [id, until] of revoked) if (until <= now) revoked.delete(id);
  return revoked.size;
}

export function revocationCount(): number {
  return revoked.size;
}

/** Test seam: the process-wide set would otherwise leak between suites. */
export function clearRevocations(): void {
  revoked.clear();
}

/** Rebuilds the set at boot, so a restart does not resurrect a session. */
export async function loadRevocations(): Promise<void> {
  try {
    const since = new Date(Date.now() - WINDOW_MS);
    const rows = await prisma.refreshToken.findMany({
      where: { revokedAt: { gte: since } },
      select: { id: true, revokedAt: true },
    });
    for (const row of rows) revoked.set(row.id, row.revokedAt!.getTime() + WINDOW_MS);
    log.boot.info({ sessions: revoked.size }, 'recently revoked sessions loaded');
  } catch (err) {
    log.boot.error({ err }, 'could not load revoked sessions');
  }
}
