import { prisma } from '../lib/prisma.js';
import { settings } from './settings.js';
import { applyLedger, type TxClient } from './wallet.js';

/**
 * Pays the referrer a share of a referred trader's deposit. The unique
 * constraint on depositId means a deposit can only ever pay once, and a
 * failure here must never roll back the deposit itself.
 */
export async function payReferralCommission(
  tx: TxClient,
  params: { referredId: string; depositId: string; depositCents: number },
): Promise<number> {
  const rate = settings.get('growth.referralCommissionPct');
  if (!(rate > 0)) return 0;

  const referred = await tx.user.findUnique({
    where: { id: params.referredId },
    select: { referredById: true, email: true },
  });
  if (!referred?.referredById) return 0;

  const existing = await tx.referralCommission.findUnique({ where: { depositId: params.depositId } });
  if (existing) return 0;

  const amount = Math.floor((params.depositCents * rate) / 100);
  if (amount <= 0) return 0;

  await tx.referralCommission.create({
    data: {
      referrerId: referred.referredById,
      referredId: params.referredId,
      depositId: params.depositId,
      amount,
      rate,
    },
  });
  await tx.user.update({
    where: { id: referred.referredById },
    data: { referralEarnings: { increment: amount } },
  });
  await applyLedger(tx, {
    userId: referred.referredById,
    accountType: 'REAL',
    type: 'REFERRAL_COMMISSION',
    amount,
    refType: 'deposit',
    refId: params.depositId,
    note: `${rate}% commission on a referred deposit`,
  });
  return amount;
}

export async function referralSummary(userId: string) {
  const [user, referrals, commissions] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { referralCode: true, referralEarnings: true } }),
    prisma.user.findMany({
      where: { referredById: userId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: { id: true, name: true, createdAt: true, totalDeposited: true },
    }),
    prisma.referralCommission.findMany({
      where: { referrerId: userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
  ]);

  return {
    code: user?.referralCode ?? '',
    earnings: user?.referralEarnings ?? 0,
    commissionPct: settings.get('growth.referralCommissionPct'),
    // only the display name is exposed — a referrer never sees a referral's email
    referrals: referrals.map((r) => ({
      id: r.id,
      name: r.name,
      joinedAt: r.createdAt,
      deposited: r.totalDeposited,
    })),
    commissions,
  };
}
