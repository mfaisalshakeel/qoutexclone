import { Router } from 'express';
import { z } from 'zod';
import { badRequest, wrap } from '../lib/errors.js';
import { PROVIDER_KINDS } from '../services/payments.js';
import { processPaymentWebhook } from '../services/provider-deposits.js';

/**
 * Inbound payment webhooks.
 *
 * Public and unauthenticated by nature — a payment processor is not one of
 * our traders — so the signature in `processPaymentWebhook` is the entire
 * defence, checked against the raw bytes `app.ts` captures alongside the
 * parsed body. No route here trusts anything before that check passes.
 */
const router = Router();

router.post(
  '/payments/:provider',
  wrap(async (req, res) => {
    const provider = z.enum(PROVIDER_KINDS).safeParse(req.params.provider.toUpperCase());
    if (!provider.success) throw badRequest('Unknown payment provider', 'unknown_provider');

    const rawBody = (req as typeof req & { rawBody?: Buffer }).rawBody;
    if (!rawBody) throw badRequest('Missing request body', 'missing_body');

    const result = await processPaymentWebhook(provider.data, req.headers, rawBody);
    res.json(result);
  }),
);

export default router;
