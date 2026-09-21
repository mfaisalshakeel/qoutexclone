import type { PaymentMethod } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';

/**
 * The provider framework.
 *
 * A `PaymentProvider` is the code that knows how to move money for one kind of
 * method: derive or open a deposit destination, prove a webhook is genuine,
 * send a payout. A `PaymentMethod` row is the operator-editable half — fees,
 * limits, countries, whether it is offered at all — for one specific method
 * (a crypto network, a card currency, an e-wallet currency) that a provider
 * handles. The split matters because the first half needs a deploy and the
 * second must not: a fee correction is not a code change.
 */

export const PROVIDER_KINDS = ['CRYPTO', 'CARD', 'EWALLET'] as const;
export type ProviderKind = (typeof PROVIDER_KINDS)[number];

export interface DepositDestination {
  /** What the trader is shown to complete the deposit: an address, a redirect URL… */
  address: string;
  memo?: string;
  /** Provider-specific data the trader's client needs (e.g. a checkout session id). */
  meta?: Record<string, unknown>;
}

export interface WebhookEvent {
  /** The provider's own reference for this transfer, for idempotent crediting. */
  externalId: string;
  kind: 'deposit_confirmed' | 'payout_sent' | 'payout_failed';
  amountCents?: number;
  raw: unknown;
}

export interface PayoutRequest {
  method: PaymentMethod;
  amountCents: number;
  /** An address, IBAN, or account handle — whatever the method expects. */
  destination: string;
  reference: string;
}

export interface PayoutResult {
  externalId: string;
  status: 'SENT' | 'PENDING' | 'FAILED';
}

/**
 * What one kind of payment mechanism knows how to do.
 *
 * `verifyWebhook` returns null for a signature that does not check out — never
 * throws — so a route can log a rejected webhook without crashing on one a
 * stranger sent to probe the endpoint.
 */
export interface PaymentProvider {
  readonly kind: ProviderKind;
  createDepositDestination(method: PaymentMethod, userId: string): Promise<DepositDestination>;
  verifyWebhook(headers: Record<string, string | string[] | undefined>, rawBody: Buffer): WebhookEvent | null;
  payout(request: PayoutRequest): Promise<PayoutResult>;
}

const registry = new Map<ProviderKind, PaymentProvider>();

export function registerProvider(provider: PaymentProvider): void {
  registry.set(provider.kind, provider);
}

export function providerFor(kind: ProviderKind): PaymentProvider {
  const provider = registry.get(kind);
  if (!provider) throw new Error(`no payment provider registered for ${kind}`);
  return provider;
}

/** Test seam: providers are process-wide singletons otherwise. */
export function _clearProviders(): void {
  registry.clear();
}

/* -------------------------------------------------------------------------- */
/* Methods                                                                    */
/* -------------------------------------------------------------------------- */

export async function listMethods(options: { includeDisabled?: boolean } = {}) {
  return prisma.paymentMethod.findMany({
    where: options.includeDisabled ? undefined : { enabled: true },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  });
}

/** The key a seeded crypto method uses: `crypto-<currency>-<network>`, lowercase. */
export function cryptoMethodKey(currency: string, network: string): string {
  return `crypto-${currency.toLowerCase()}-${network.toLowerCase()}`;
}

/** Same lookup, but null instead of throwing — callers that fall back to a
 *  static default when no row exists yet (e.g. a network just added in code
 *  and not yet seeded) use this one. */
export async function findMethod(key: string): Promise<PaymentMethod | null> {
  return prisma.paymentMethod.findUnique({ where: { key } });
}

export async function methodByKey(key: string): Promise<PaymentMethod> {
  const method = await prisma.paymentMethod.findUnique({ where: { key } });
  if (!method) throw notFound('That payment method does not exist');
  return method;
}

/** The countries list is an allow-list; empty means every country. */
export function isOfferedIn(method: PaymentMethod, countryCode: string | null | undefined): boolean {
  const countries = Array.isArray(method.countries) ? (method.countries as string[]) : [];
  if (countries.length === 0) return true;
  if (!countryCode) return true; // unknown country is never refused, only a listed one is excluded
  return countries.includes(countryCode.toUpperCase());
}

/** Throws with a message a trader can act on when a method cannot be used. */
export function assertMethodAvailable(method: PaymentMethod, countryCode?: string | null): void {
  if (!method.enabled) throw badRequest('That payment method is not available right now', 'method_disabled');
  if (!isOfferedIn(method, countryCode)) {
    throw forbidden('That payment method is not offered in your country');
  }
}

export interface FeeQuote {
  fee: number;
  net: number;
}

/** A method's fee on an amount: a flat cost plus a percentage, both in cents. */
export function feeFor(method: PaymentMethod, amountCents: number): FeeQuote {
  const pct = Math.round((amountCents * method.feePct) / 100);
  const fee = method.feeFlatCents + pct;
  return { fee, net: Math.max(amountCents - fee, 0) };
}

/**
 * Checks an amount against a method's configured limits.
 *
 * A limit of 0 means "no cap" on that side, matching how `maxDepositCents`
 * and `maxWithdrawCents` are documented on the model — a method with no
 * maximum is not a method capped at nothing.
 */
export function assertWithinLimits(
  method: PaymentMethod,
  amountCents: number,
  direction: 'deposit' | 'withdraw',
): void {
  const min = direction === 'deposit' ? method.minDepositCents : method.minWithdrawCents;
  const max = direction === 'deposit' ? method.maxDepositCents : method.maxWithdrawCents;
  if (amountCents < min) {
    throw badRequest(
      `Minimum ${direction} for ${method.label} is $${(min / 100).toFixed(2)}`,
      'below_minimum',
    );
  }
  if (max > 0 && amountCents > max) {
    throw badRequest(
      `Maximum ${direction} for ${method.label} is $${(max / 100).toFixed(2)}`,
      'above_maximum',
    );
  }
}
