import crypto from 'node:crypto';
import type { User } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { badRequest, notFound } from '../lib/errors.js';
import { storage } from './storage.js';
import { revokeOtherSessions } from './security.js';

/**
 * A right-to-erasure request meets the platform's own hard invariants
 * head-on: `Trade`/`Transaction`/`Deposit`/`Withdrawal` are the ledger, and
 * GDPR's own Article 17(3)(b) carves out exactly this case — data kept to
 * meet a legal obligation (financial recordkeeping, AML) does not have to be
 * erased. So this never calls `prisma.user.delete()`, which would cascade
 * and destroy that history outright (the schema's `onDelete: Cascade` on
 * those relations was written for referential integrity, not for this).
 * Instead: rows with no financial or audit meaning are hard-deleted, rows
 * that must survive but carry PII outside their `userId` foreign key
 * (`LoginEvent`, `EmailMessage`, `KycSubmission`) get that PII scrubbed in
 * place, the ledger and trade history are left completely untouched, and the
 * `User` row itself survives with its PII replaced — every foreign key still
 * resolves, nothing is left dangling.
 *
 * Scoped to trader accounts. An admin's own identity is a different,
 * riskier operation (their `UserNote.authorId` is required and `Restrict`s
 * a delete elsewhere, and an admin's own audit trail matters differently)
 * and is refused here rather than half-handled.
 */

function assertEligible(user: Pick<User, 'role'>): void {
  if (user.role === 'ADMIN') {
    throw badRequest('Staff accounts are not handled by this tool', 'not_a_trader');
  }
}

export interface UserDataExport {
  exportedAt: string;
  account: Record<string, unknown>;
  trading: {
    trades: unknown[];
    pendingTrades: unknown[];
    tournamentEntries: unknown[];
  };
  wallet: {
    transactions: unknown[];
    deposits: unknown[];
    withdrawals: unknown[];
    depositAddresses: unknown[];
    bonuses: unknown[];
  };
  identity: {
    kycSubmissions: unknown[];
  };
  referrals: {
    code: string;
    earnings: number;
    commissionsEarned: unknown[];
    commissionsGiven: unknown[];
  };
  support: {
    tickets: unknown[];
  };
  activity: {
    loginHistory: unknown[];
    sessions: unknown[];
    notifications: unknown[];
    promoRedemptions: unknown[];
    notes: unknown[];
  };
}

/**
 * Everything the platform holds tied to this account, for a data-portability
 * request. Session tokens are represented by their metadata (device, address,
 * timestamps) never the token hash itself — that is a credential, not data
 * about the person. KYC document images are not embedded (see `documentRef`
 * on each submission instead) — the JSON export stays a JSON export rather
 * than growing an image-download pipeline this task does not otherwise need.
 */
export async function exportUserData(userId: string): Promise<UserDataExport> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw notFound('Account not found');

  const [
    trades,
    pendingTrades,
    tournamentEntries,
    transactions,
    deposits,
    withdrawals,
    depositAddresses,
    bonuses,
    kycSubmissions,
    commissionsEarned,
    commissionsGiven,
    tickets,
    loginHistory,
    sessions,
    notifications,
    promoRedemptions,
    notes,
  ] = await Promise.all([
    prisma.trade.findMany({ where: { userId }, orderBy: { openedAt: 'desc' } }),
    prisma.pendingTrade.findMany({ where: { userId } }),
    prisma.tournamentEntry.findMany({ where: { userId } }),
    prisma.transaction.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } }),
    prisma.deposit.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } }),
    prisma.withdrawal.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } }),
    prisma.depositAddress.findMany({ where: { userId } }),
    prisma.bonus.findMany({ where: { userId } }),
    prisma.kycSubmission.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } }),
    prisma.referralCommission.findMany({ where: { referrerId: userId } }),
    prisma.referralCommission.findMany({ where: { referredId: userId } }),
    prisma.supportTicket.findMany({
      where: { userId },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    }),
    prisma.loginEvent.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } }),
    prisma.refreshToken.findMany({
      where: { userId },
      select: {
        id: true,
        device: true,
        ip: true,
        createdAt: true,
        lastUsedAt: true,
        expiresAt: true,
        revokedAt: true,
      },
    }),
    prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } }),
    prisma.promoRedemption.findMany({ where: { userId } }),
    // notes written ABOUT this trader by staff — not notes they authored
    prisma.userNote.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } }),
  ]);

  const { passwordHash: _passwordHash, twoFactorSecret: _twoFactorSecret, ...account } = user;

  return {
    exportedAt: new Date().toISOString(),
    account,
    trading: { trades, pendingTrades, tournamentEntries },
    wallet: { transactions, deposits, withdrawals, depositAddresses, bonuses },
    identity: { kycSubmissions },
    referrals: {
      code: user.referralCode,
      earnings: user.referralEarnings,
      commissionsEarned,
      commissionsGiven,
    },
    support: { tickets },
    activity: { loginHistory, sessions, notifications, promoRedemptions, notes },
  };
}

const ANONYMIZED_NAME = 'Deleted account';

/**
 * Erases what can be erased and anonymises what must survive. Runs as one
 * transaction for the database side; the KYC file itself lives outside the
 * database (see `services/storage.ts`), so it is only removed once the
 * transaction has actually committed — deleting a file cannot be rolled back,
 * so it must never happen before the row that references it is safely gone.
 */
export async function eraseUserData(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw notFound('Account not found');
  assertEligible(user);

  const kycDocuments = await prisma.kycSubmission.findMany({
    where: { userId, documentRef: { not: null } },
    select: { documentRef: true },
  });

  await prisma.$transaction(async (tx) => {
    // no financial or audit meaning — safe to remove outright
    await tx.refreshToken.deleteMany({ where: { userId } });
    await tx.emailVerificationToken.deleteMany({ where: { userId } });
    await tx.backupCode.deleteMany({ where: { userId } });
    await tx.notification.deleteMany({ where: { userId } });
    await tx.achievement.deleteMany({ where: { userId } });
    await tx.responsibleLimits.deleteMany({ where: { userId } });
    await tx.inventoryItem.deleteMany({ where: { userId } });
    await tx.depositAddress.deleteMany({ where: { userId } });
    await tx.passwordResetToken.deleteMany({ where: { userId } });
    await tx.tournamentEntry.deleteMany({ where: { userId } });
    await tx.pendingTrade.deleteMany({ where: { userId } });
    await tx.userNote.deleteMany({ where: { userId } }); // notes ABOUT this trader

    // must survive (audit trail / delivery record) but carries PII outside
    // its userId — scrub the PII, keep the row
    await tx.loginEvent.updateMany({
      where: { userId },
      data: { email: 'erased@deleted.invalid', ip: null, userAgent: null, device: 'Erased', fingerprint: 'erased' },
    });
    await tx.emailMessage.updateMany({
      where: { userId },
      data: { to: 'erased@deleted.invalid', html: '', text: '' },
    });
    await tx.kycSubmission.updateMany({
      where: { userId },
      data: {
        fullName: ANONYMIZED_NAME,
        dateOfBirth: '0000-00-00',
        address: 'Erased',
        documentNumber: 'Erased',
        documentRef: null,
      },
    });

    // financial ledger and trading/support history: untouched, on purpose —
    // see the module comment

    // the account itself survives, so every foreign key above still resolves
    await tx.user.update({
      where: { id: userId },
      data: {
        email: `deleted-${userId}@deleted.invalid`,
        name: ANONYMIZED_NAME,
        passwordHash: crypto.randomUUID(),
        country: null,
        avatar: null,
        timezone: null,
        twoFactorSecret: null,
        twoFactorPending: null,
        twoFactorEnabledAt: null,
      },
    });
  });

  for (const { documentRef } of kycDocuments) {
    if (documentRef) await storage.delete(documentRef);
  }

  await revokeOtherSessions(userId, null);
}
