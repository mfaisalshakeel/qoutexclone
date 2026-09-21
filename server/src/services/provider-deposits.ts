import { prisma } from '../lib/prisma.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { usdToCents } from '../lib/money.js';
import { settings } from './settings.js';
import { assertCanDeposit } from './responsible.js';
import { previewPromo } from './promos.js';
import { previewOffer } from './bonuses.js';
import {
  assertMethodAvailable,
  assertWithinLimits,
  buildSandboxWebhook,
  methodByKey,
  providerFor,
  type ProviderKind,
} from './payments.js';
import { completeDeposit, depositEvents } from './deposits.js';

/**
 * Deposits through the provider framework: card and e-wallet.
 *
 * Crypto keeps its own path in `deposits.ts` — an address, a chain watcher, a
 * confirmation count — because that is what it actually is. A card or
 * e-wallet deposit is a checkout session and a webhook, so it is a different
 * shape of thing, not the same function with an `if` in it. Both paths end at
 * the same place: `completeDeposit`, which is what actually credits money and
 * is already idempotent and already carries every bonus rule.
 */

export interface CreateProviderDepositInput {
  userId: string;
  methodKey: string;
  usdAmount: number;
  promoCode?: string;
  bonusOfferId?: string;
}

export async function createProviderDeposit(input: CreateProviderDepositInput) {
  const method = await methodByKey(input.methodKey);
  if (method.provider === 'CRYPTO') {
    throw badRequest('Use the crypto deposit flow for this method', 'wrong_flow');
  }

  const trader = await prisma.user.findUnique({ where: { id: input.userId }, select: { country: true } });
  assertMethodAvailable(method, trader?.country);

  const cents = usdToCents(input.usdAmount);
  assertWithinLimits(method, cents, 'deposit');
  await assertCanDeposit(input.userId, cents);

  // validated now so a bad code fails at checkout, not silently at credit time
  const promoCode = input.promoCode?.trim().toUpperCase() || undefined;
  if (promoCode) await previewPromo(promoCode, input.userId, cents);
  const bonusOfferId = input.bonusOfferId?.trim() || undefined;
  if (bonusOfferId) await previewOffer(bonusOfferId, cents);

  const pending = await prisma.deposit.count({
    where: { userId: input.userId, status: { in: ['AWAITING_PAYMENT', 'CONFIRMING'] } },
  });
  if (pending >= 5) throw conflict('You already have too many pending deposits', 'too_many_pending');

  const provider = providerFor(method.provider as ProviderKind);
  const destination = await provider.createDepositDestination(method, input.userId);
  const sessionId = (destination.meta?.sessionId as string | undefined) ?? destination.address;

  const deposit = await prisma.deposit.create({
    data: {
      userId: input.userId,
      currency: method.currency,
      network: method.provider,
      address: destination.address,
      cryptoAmount: input.usdAmount.toFixed(2),
      rate: 1,
      requiredConf: 1,
      promoCode,
      bonusOfferId,
      externalRef: sessionId,
      status: 'AWAITING_PAYMENT',
      expiresAt: new Date(Date.now() + settings.get('wallet.depositWindowMinutes') * 60 * 1000),
    },
  });
  depositEvents.emit('created', deposit);
  return deposit;
}

/**
 * Verifies a webhook and, on a genuine deposit confirmation, credits it.
 *
 * Idempotent by construction: `completeDeposit` already refuses to pay a
 * deposit that has left `AWAITING_PAYMENT`/`CONFIRMING`, so a provider
 * retrying the same webhook — which every real one eventually does — is a
 * no-op the second time, not a double credit.
 */
export async function processPaymentWebhook(
  providerKind: ProviderKind,
  headers: Record<string, string | string[] | undefined>,
  rawBody: Buffer,
): Promise<{ ok: true; ignored?: boolean }> {
  const provider = providerFor(providerKind);
  const event = provider.verifyWebhook(headers, rawBody);
  if (!event) throw badRequest('Invalid webhook signature', 'bad_signature');

  if (event.kind !== 'deposit_confirmed') return { ok: true, ignored: true };

  const deposit = await prisma.deposit.findUnique({ where: { externalRef: event.externalId } });
  if (!deposit) throw notFound('No deposit matches this webhook');

  await completeDeposit(deposit.id, { txHash: event.externalId });
  return { ok: true };
}

/**
 * The sandbox's own "pay now" button.
 *
 * It builds the same signed event a real card or e-wallet provider would send
 * and delivers it through the exact verification path a genuine webhook takes
 * — nothing here bypasses the signature check the way calling
 * `completeDeposit` directly would.
 */
export async function simulateProviderPayment(userId: string, depositId: string): Promise<void> {
  const deposit = await prisma.deposit.findUnique({ where: { id: depositId } });
  if (!deposit || deposit.userId !== userId) throw notFound('Deposit not found');
  if (deposit.status !== 'AWAITING_PAYMENT') {
    throw conflict('Deposit is no longer awaiting payment', 'bad_status');
  }
  if (!deposit.externalRef || (deposit.network !== 'CARD' && deposit.network !== 'EWALLET')) {
    throw badRequest('This deposit has no sandbox payment to simulate', 'not_sandbox');
  }

  const { body, headers } = buildSandboxWebhook(deposit.network as ProviderKind, {
    externalId: deposit.externalRef,
    amountCents: usdToCents(Number(deposit.cryptoAmount)),
  });
  await processPaymentWebhook(deposit.network as ProviderKind, headers, body);
}
