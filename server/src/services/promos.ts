import type { PromoCode } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { badRequest, notFound } from '../lib/errors.js';
import { applyLedger, type TxClient } from './wallet.js';

export const PROMO_KINDS = ['DEPOSIT_BONUS_PCT', 'FIXED_CREDIT'] as const;

export interface PromoPreview {
  code: string;
  kind: string;
  bonus: number; // cents that would be credited
  description: string;
}

/** Bonus a code is worth on a deposit of `depositCents`, capped and floored. */
export function bonusFor(
  promo: Pick<PromoCode, 'kind' | 'value' | 'maxBonus'>,
  depositCents: number,
): number {
  const raw = promo.kind === 'FIXED_CREDIT' ? promo.value : Math.floor((depositCents * promo.value) / 100);
  if (raw <= 0) return 0;
  return promo.maxBonus > 0 ? Math.min(raw, promo.maxBonus) : raw;
}

export function describe(promo: Pick<PromoCode, 'kind' | 'value' | 'minDeposit' | 'maxBonus'>): string {
  const head =
    promo.kind === 'FIXED_CREDIT'
      ? `$${(promo.value / 100).toFixed(2)} credit`
      : `${promo.value}% deposit bonus`;
  const min = promo.minDeposit > 0 ? `, min deposit $${(promo.minDeposit / 100).toFixed(2)}` : '';
  const cap = promo.maxBonus > 0 ? `, up to $${(promo.maxBonus / 100).toFixed(2)}` : '';
  return `${head}${min}${cap}`;
}

/**
 * Validates a code for this user and deposit size without consuming it.
 * Throws with a human-readable reason so the UI can show it as typed.
 */
export async function previewPromo(
  code: string,
  userId: string,
  depositCents: number,
): Promise<PromoPreview> {
  const promo = await prisma.promoCode.findUnique({ where: { code: code.trim().toUpperCase() } });
  if (!promo || !promo.enabled) throw notFound('That promo code is not valid');
  if (promo.expiresAt && promo.expiresAt < new Date())
    throw badRequest('That promo code has expired', 'promo_expired');
  if (promo.maxRedemptions > 0 && promo.redemptions >= promo.maxRedemptions) {
    throw badRequest('That promo code has been fully claimed', 'promo_exhausted');
  }
  if (depositCents < promo.minDeposit) {
    throw badRequest(
      `This code needs a deposit of at least $${(promo.minDeposit / 100).toFixed(2)}`,
      'promo_min_deposit',
    );
  }
  const used = await prisma.promoRedemption.findUnique({
    where: { promoCodeId_userId: { promoCodeId: promo.id, userId } },
  });
  if (used) throw badRequest('You have already used that promo code', 'promo_used');

  const bonus = bonusFor(promo, depositCents);
  if (bonus <= 0) throw badRequest('That code adds nothing to this deposit', 'promo_zero');
  return { code: promo.code, kind: promo.kind, bonus, description: describe(promo) };
}

/**
 * Credits the bonus for a completed deposit. Runs inside the deposit's own
 * transaction, and the unique (code, user) redemption row makes double
 * claiming impossible even under a race.
 */
export async function redeemPromo(
  tx: TxClient,
  params: { code: string; userId: string; depositId: string; depositCents: number },
): Promise<number> {
  const promo = await tx.promoCode.findUnique({ where: { code: params.code.trim().toUpperCase() } });
  if (!promo || !promo.enabled) return 0;
  if (promo.expiresAt && promo.expiresAt < new Date()) return 0;
  if (promo.maxRedemptions > 0 && promo.redemptions >= promo.maxRedemptions) return 0;
  if (params.depositCents < promo.minDeposit) return 0;

  const bonus = bonusFor(promo, params.depositCents);
  if (bonus <= 0) return 0;

  const existing = await tx.promoRedemption.findUnique({
    where: { promoCodeId_userId: { promoCodeId: promo.id, userId: params.userId } },
  });
  if (existing) return 0;

  await tx.promoRedemption.create({
    data: { promoCodeId: promo.id, userId: params.userId, depositId: params.depositId, amount: bonus },
  });
  await tx.promoCode.update({ where: { id: promo.id }, data: { redemptions: { increment: 1 } } });
  await applyLedger(tx, {
    userId: params.userId,
    accountType: 'REAL',
    type: 'BONUS',
    amount: bonus,
    refType: 'promo',
    refId: promo.id,
    note: `Promo ${promo.code}: ${describe(promo)}`,
  });
  return bonus;
}
