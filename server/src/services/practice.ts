import type { User } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { badRequest, notFound } from '../lib/errors.js';
import { formatUsd } from '../lib/money.js';
import { settings } from './settings.js';
import { applyLedger } from './wallet.js';

/**
 * The practice account's top-up.
 *
 * An operator can require the balance to have run down first
 * (`trading.practiceRefillBelow`, 0 to always allow it). The rule lives here
 * rather than only in the switcher, because a disabled button is not a rule —
 * and the money still moves through `applyLedger`, so a practice top-up is as
 * auditable as any other balance change.
 */
export async function refillPractice(userId: string): Promise<User> {
  const target = settings.get('trading.practiceStartBalance');
  const below = settings.get('trading.practiceRefillBelow');

  return prisma.$transaction(async (tx) => {
    const current = await tx.user.findUnique({ where: { id: userId }, select: { demoBalance: true } });
    if (!current) throw notFound('Account not found');

    if (below > 0 && current.demoBalance >= below) {
      throw badRequest(
        `A top-up is available once your practice balance falls below $${formatUsd(below)}.`,
        'refill_not_needed',
      );
    }

    const delta = target - current.demoBalance;
    if (delta !== 0) {
      await applyLedger(tx, {
        userId,
        accountType: 'DEMO',
        type: 'DEMO_RESET',
        amount: delta,
        note: 'Practice balance topped up',
      });
    }
    return tx.user.findUniqueOrThrow({ where: { id: userId } });
  });
}
