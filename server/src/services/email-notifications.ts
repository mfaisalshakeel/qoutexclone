import type { Deposit, KycSubmission, Withdrawal } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { log } from '../lib/logger.js';
import { depositEvents } from './deposits.js';
import { withdrawalEvents } from './withdrawals.js';
import { kycEvents } from './kyc.js';
import { tournamentEvents } from './tournaments.js';
import { sendMail, siteUrl } from './mailer.js';
import { depositCredited, kycResult, tournamentResult, withdrawalUpdate } from './email-templates.js';

/**
 * The emails the platform sends about money and status.
 *
 * A separate listener from the in-app notification centre, on the same events:
 * a notification is a line a trader sees next time they open the app, and an
 * email is what reaches them when they do not. They answer different questions
 * and their wording is not the same, so they are not one code path.
 *
 * Nothing here ever throws at the emitter. A mail server being down must not
 * fail a deposit.
 */

/** The statuses worth an email. The rest are steps nobody asked about. */
const WITHDRAWAL_MILESTONES = new Set(['APPROVED', 'PROCESSING', 'COMPLETED', 'REJECTED', 'CANCELLED']);

let listening = false;

async function recipient(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true },
  });
}

export function attachEmailNotifications(): void {
  if (listening) return;
  listening = true;

  depositEvents.on('updated', (deposit: Deposit | null) => {
    if (!deposit || deposit.status !== 'COMPLETED') return;
    void (async () => {
      try {
        const user = await recipient(deposit.userId);
        if (!user) return;
        await sendMail({
          ...depositCredited({
            name: user.name,
            amount: deposit.creditedAmount,
            bonus: deposit.bonusAmount,
            currency: deposit.currency,
            network: deposit.network,
            url: siteUrl('/wallet'),
          }),
          to: user.email,
          template: 'deposit-credited',
          userId: user.id,
        });
      } catch (err) {
        log.mail.error({ err, depositId: deposit.id }, 'could not email a credited deposit');
      }
    })();
  });

  withdrawalEvents.on('updated', (withdrawal: Withdrawal | null) => {
    if (!withdrawal || !WITHDRAWAL_MILESTONES.has(withdrawal.status)) return;
    void (async () => {
      try {
        const user = await recipient(withdrawal.userId);
        if (!user) return;
        await sendMail({
          ...withdrawalUpdate({
            name: user.name,
            status: withdrawal.status,
            amount: withdrawal.amount,
            note: withdrawal.adminNote,
            url: siteUrl('/wallet?tab=withdraw'),
          }),
          to: user.email,
          template: `withdrawal-${withdrawal.status.toLowerCase()}`,
          userId: user.id,
        });
      } catch (err) {
        log.mail.error({ err, withdrawalId: withdrawal.id }, 'could not email a withdrawal update');
      }
    })();
  });

  kycEvents.on('reviewed', (submission: KycSubmission | null) => {
    if (!submission) return;
    void (async () => {
      try {
        const user = await recipient(submission.userId);
        if (!user) return;
        const approved = submission.status === 'APPROVED';
        await sendMail({
          ...kycResult({
            name: user.name,
            approved,
            reason: submission.note,
            url: siteUrl('/account'),
          }),
          to: user.email,
          template: approved ? 'kyc-approved' : 'kyc-rejected',
          userId: user.id,
        });
      } catch (err) {
        log.mail.error({ err, submissionId: submission.id }, 'could not email a KYC decision');
      }
    })();
  });

  tournamentEvents.on('finished', (tournament: { id: string; name: string } | null) => {
    if (!tournament) return;
    void (async () => {
      try {
        const entries = await prisma.tournamentEntry.findMany({
          where: { tournamentId: tournament.id },
          select: { rank: true, prize: true, user: { select: { id: true, email: true, name: true } } },
        });
        for (const entry of entries) {
          await sendMail({
            ...tournamentResult({
              name: entry.user.name,
              tournament: tournament.name,
              place: entry.rank,
              prize: entry.prize,
              url: siteUrl('/tournaments'),
            }),
            to: entry.user.email,
            template: 'tournament-result',
            userId: entry.user.id,
          });
        }
      } catch (err) {
        log.mail.error({ err, tournamentId: tournament.id }, 'could not email tournament results');
      }
    })();
  });
}
