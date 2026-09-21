import { NETWORKS } from '../lib/crypto-networks.js';

/**
 * The methods the platform ships with.
 *
 * One `PaymentMethod` row per crypto network, seeded from `NETWORKS` (the
 * mechanics stay in code) with the fees and limits it already used. Seeded
 * once by key and never overwritten, so an operator's edits survive a re-seed.
 * Card and e-wallet methods arrive with their providers.
 */
export const DEFAULT_PAYMENT_METHODS = NETWORKS.map((spec, index) => ({
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
