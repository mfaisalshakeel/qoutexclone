import crypto from 'node:crypto';
import type { PaymentMethod } from '@prisma/client';
import { badRequest } from '../../lib/errors.js';
import { verifySandboxWebhook } from '../payments.js';
import type {
  DepositDestination,
  PaymentProvider,
  PayoutRequest,
  PayoutResult,
  WebhookEvent,
} from '../payments.js';

/**
 * A sandbox card gateway.
 *
 * There is no real processor behind this — Real credentials are Blocked on
 * owner — but the shape is what integrating one looks like: a checkout
 * session is opened, the trader pays on the provider's own hosted page, and a
 * signed webhook confirms it later. Nothing here is faked at the interface:
 * the signature is real HMAC, verified the same way a live gateway's would be.
 *
 * Cards do not pay out. A real gateway can only refund a charge it captured,
 * not send an arbitrary amount to an arbitrary card — that is what e-wallets
 * and crypto are for, and this platform's withdrawal methods reflect that.
 */
export const cardProvider: PaymentProvider = {
  kind: 'CARD',

  async createDepositDestination(_method: PaymentMethod, userId: string): Promise<DepositDestination> {
    const sessionId = `card_${crypto.randomBytes(12).toString('hex')}`;
    return {
      address: sessionId,
      meta: { sessionId, userId },
    };
  },

  verifyWebhook(headers, rawBody): WebhookEvent | null {
    return verifySandboxWebhook('CARD', headers, rawBody);
  },

  async payout(_request: PayoutRequest): Promise<PayoutResult> {
    throw badRequest('Card is a deposit-only method and cannot pay out', 'payout_unsupported');
  },
};
