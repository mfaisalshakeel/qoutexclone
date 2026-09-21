import crypto from 'node:crypto';
import type { PaymentMethod } from '@prisma/client';
import { verifySandboxWebhook } from '../payments.js';
import type {
  DepositDestination,
  PaymentProvider,
  PayoutRequest,
  PayoutResult,
  WebhookEvent,
} from '../payments.js';

/**
 * A sandbox e-wallet provider.
 *
 * Deposits work the same way the card gateway's do: a checkout session, then
 * a signed webhook. Unlike a card, an e-wallet account is also a payout
 * destination — real ones settle to an account handle rather than an address,
 * which is why `payout` here needs only the destination string a trader gave,
 * not a crypto network.
 */
export const ewalletProvider: PaymentProvider = {
  kind: 'EWALLET',
  supportsPayout: true,

  async createDepositDestination(_method: PaymentMethod, userId: string): Promise<DepositDestination> {
    const sessionId = `ewallet_${crypto.randomBytes(12).toString('hex')}`;
    return {
      address: sessionId,
      meta: { sessionId, userId },
    };
  },

  verifyWebhook(headers, rawBody): WebhookEvent | null {
    return verifySandboxWebhook('EWALLET', headers, rawBody);
  },

  async payout(request: PayoutRequest): Promise<PayoutResult> {
    // sandbox: a real e-wallet payout API call happens here, addressed to
    // request.destination for request.amountCents, and returns its own
    // reference; simulated as an instant success
    void request;
    return { externalId: `ewpay_${crypto.randomBytes(12).toString('hex')}`, status: 'SENT' };
  },
};
