import { NETWORKS } from '../lib/crypto-networks.js';

/**
 * The methods the platform ships with.
 *
 * One `PaymentMethod` row per crypto network, seeded from `NETWORKS` (the
 * mechanics stay in code) with the fees and limits it already used. Seeded
 * once by key and never overwritten, so an operator's edits survive a re-seed.
 * Card and e-wallet methods arrive with their providers.
 */
const cryptoMethods = NETWORKS.map((spec, index) => ({
  provider: 'CRYPTO',
  key: `crypto-${spec.currency.toLowerCase()}-${spec.network.toLowerCase()}`,
  label: spec.label,
  currency: spec.currency,
  network: spec.network,
  feePct: 0,
  feeFlatCents: Math.round(spec.networkFeeUsd * 100),
  minDepositCents: Math.round(spec.minDepositUsd * 100),
  maxDepositCents: 0,
  minWithdrawCents: Math.round(spec.minWithdrawUsd * 100),
  maxWithdrawCents: 0,
  sortOrder: index * 10,
}));

/**
 * The sandbox card and e-wallet methods. There is no real processor behind
 * either — real credentials are the owner's to supply — so the limits here
 * are placeholders sized for demonstrating the flow, not for real money.
 */
const providerMethods = [
  {
    provider: 'CARD',
    key: 'card-usd',
    label: 'Card (sandbox)',
    currency: 'USD',
    network: null,
    feePct: 2.9,
    feeFlatCents: 30,
    minDepositCents: 1_000,
    maxDepositCents: 500_000,
    minWithdrawCents: 0,
    maxWithdrawCents: 0,
    sortOrder: 100,
  },
  {
    provider: 'EWALLET',
    key: 'ewallet-usd',
    label: 'E-wallet (sandbox)',
    currency: 'USD',
    network: null,
    feePct: 1.5,
    feeFlatCents: 0,
    minDepositCents: 1_000,
    maxDepositCents: 1_000_000,
    minWithdrawCents: 1_000,
    maxWithdrawCents: 1_000_000,
    sortOrder: 110,
  },
];

export const DEFAULT_PAYMENT_METHODS = [...cryptoMethods, ...providerMethods];
