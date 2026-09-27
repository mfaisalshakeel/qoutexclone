import { prisma } from '../lib/prisma.js';
import { log } from '../lib/logger.js';
import { settings } from './settings.js';

/**
 * Rows that accumulate forever with no natural cap: a login attempt on every
 * sign-in, and a session row on every device. Both get pruned on the same
 * schedule as `notifications.prune()` (`services/notifications.ts`), which
 * this mirrors exactly — a `setInterval`, `.unref()`, and an immediate run at
 * boot so a long-idle dev box catches up right away.
 *
 * Deliberately NOT pruned here, and not meant to be: `AuditLog` (compliance
 * trail — an admin action should stay reviewable for as long as the deploy
 * cares to keep it, which is an operator archival decision, not a default
 * timer), `Transaction`/`Trade`/`Deposit`/`Withdrawal` (the ledger and
 * trading history — financial records, not caches), and `EmailMessage` (the
 * outbox — already scoped to a small window of recent sends by how it's
 * queried, and useful as a delivery record).
 */

const SWEEP_MS = 6 * 3_600_000;

/** Login history older than the retention window. The lockout check
 *  (`assertAccountNotLockedOut`) only ever reads the last few minutes of it,
 *  so a 180-day default retention never interferes with that. */
export async function pruneLoginHistory(): Promise<number> {
  const days = settings.get('security.loginHistoryRetentionDays');
  const cutoff = new Date(Date.now() - days * 86_400_000);
  const result = await prisma.loginEvent.deleteMany({ where: { createdAt: { lt: cutoff } } });
  if (result.count > 0) log.auth.info({ removed: result.count, days }, 'pruned old login history');
  return result.count;
}

/** Sessions that have already expired — a token past its own `expiresAt` is
 *  unusable regardless of whether it was ever explicitly revoked, so there is
 *  no operator setting for this: "expired" is not a judgement call. */
export async function pruneExpiredSessions(): Promise<number> {
  const result = await prisma.refreshToken.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  if (result.count > 0) log.auth.info({ removed: result.count }, 'pruned expired sessions');
  return result.count;
}

let sweepTimer: NodeJS.Timeout | null = null;

/** Idempotent for the same reason `startNotifications` is: the integration
 *  suite imports this module freely, and a second timer would double-sweep. */
export function startRetentionSweeps(): void {
  if (sweepTimer) return;
  const sweep = () => {
    void pruneLoginHistory();
    void pruneExpiredSessions();
  };
  sweepTimer = setInterval(sweep, SWEEP_MS);
  sweepTimer.unref?.();
  sweep();
}

export function stopRetentionSweeps(): void {
  if (sweepTimer) clearInterval(sweepTimer);
  sweepTimer = null;
}
