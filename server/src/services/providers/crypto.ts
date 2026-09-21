import type { PaymentMethod } from '@prisma/client';
import { custody } from '../custody.js';
import { centsToCrypto } from '../../lib/money.js';
import { findNetwork } from '../../lib/crypto-networks.js';
import { usdRate } from '../rates.js';
import type {
  DepositDestination,
  PaymentProvider,
  PayoutRequest,
  PayoutResult,
  WebhookEvent,
} from '../payments.js';

/**
 * The crypto provider.
 *
 * A thin adapter over the existing custody layer: address derivation and
 * payouts are unchanged (the "existing flow kept" the roadmap asks for). A
 * crypto deposit is proven by the chain watcher polling confirmations or by
 * an admin marking it seen, never by an inbound webhook, so `verifyWebhook`
 * has nothing to verify and always returns null.
 */
export const cryptoProvider: PaymentProvider = {
  kind: 'CRYPTO',
  supportsPayout: true,

  async createDepositDestination(method: PaymentMethod, userId: string): Promise<DepositDestination> {
    const { address, memo } = await custody.getDepositAddress(userId, method.currency, method.network ?? '');
    return { address, memo };
  },

  verifyWebhook(): WebhookEvent | null {
    return null;
  },

  async payout(request: PayoutRequest): Promise<PayoutResult> {
    // the interface speaks cents everywhere; custody speaks decimal crypto
    // units, so the conversion happens once, here, at the boundary
    const spec = findNetwork(request.method.currency, request.method.network ?? '');
    const rate = usdRate(request.method.currency);
    const amount = centsToCrypto(request.amountCents, rate, spec?.decimals ?? 8);
    const { txHash } = await custody.sendPayout({
      currency: request.method.currency,
      network: request.method.network ?? '',
      address: request.destination,
      amount,
      reference: request.reference,
    });
    return { externalId: txHash, status: 'SENT' };
  },
};
