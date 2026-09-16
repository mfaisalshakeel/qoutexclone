import crypto from 'node:crypto';

export interface NetworkSpec {
  currency: string; // BTC | ETH | USDT
  network: string; // BITCOIN | ERC20 | TRC20
  label: string;
  decimals: number;
  confirmations: number;
  minDepositUsd: number;
  minWithdrawUsd: number;
  /** flat network fee charged on withdrawals, in USD */
  networkFeeUsd: number;
  addressPattern: RegExp;
  explorerTx: string;
}

export const NETWORKS: NetworkSpec[] = [
  {
    currency: 'BTC',
    network: 'BITCOIN',
    label: 'Bitcoin',
    decimals: 8,
    confirmations: 2,
    minDepositUsd: 10,
    minWithdrawUsd: 30,
    networkFeeUsd: 3,
    // legacy (1), p2sh (3) and bech32 (bc1) formats
    addressPattern: /^(bc1[02-9ac-hj-np-z]{11,71}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/,
    explorerTx: 'https://mempool.space/tx/',
  },
  {
    currency: 'ETH',
    network: 'ERC20',
    label: 'Ethereum (ERC-20)',
    decimals: 8,
    confirmations: 12,
    minDepositUsd: 10,
    minWithdrawUsd: 25,
    networkFeeUsd: 2.5,
    addressPattern: /^0x[a-fA-F0-9]{40}$/,
    explorerTx: 'https://etherscan.io/tx/',
  },
  {
    currency: 'USDT',
    network: 'ERC20',
    label: 'Tether (ERC-20)',
    decimals: 6,
    confirmations: 12,
    minDepositUsd: 10,
    minWithdrawUsd: 20,
    networkFeeUsd: 2,
    addressPattern: /^0x[a-fA-F0-9]{40}$/,
    explorerTx: 'https://etherscan.io/tx/',
  },
  {
    currency: 'USDT',
    network: 'TRC20',
    label: 'Tether (TRC-20)',
    decimals: 6,
    confirmations: 19,
    minDepositUsd: 10,
    minWithdrawUsd: 10,
    networkFeeUsd: 1,
    addressPattern: /^T[1-9A-HJ-NP-Za-km-z]{33}$/,
    explorerTx: 'https://tronscan.org/#/transaction/',
  },
];

export function findNetwork(currency: string, network: string): NetworkSpec | undefined {
  return NETWORKS.find((n) => n.currency === currency && n.network === network);
}

export function isValidAddress(currency: string, network: string, address: string): boolean {
  const spec = findNetwork(currency, network);
  if (!spec) return false;
  return spec.addressPattern.test(address.trim());
}

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58(bytes: Buffer, length: number): string {
  let out = '';
  let value = BigInt('0x' + bytes.toString('hex'));
  const base = BigInt(58);
  while (out.length < length) {
    out = B58[Number(value % base)] + out;
    value /= base;
    if (value === BigInt(0)) value = BigInt('0x' + crypto.createHash('sha256').update(out).digest('hex'));
  }
  return out;
}

/**
 * Deterministic per-user deposit address.
 *
 * This is the mock custody provider: it derives a stable, well-formed address
 * from a server secret so the whole deposit flow can be exercised end to end.
 * A production deployment swaps this for a real custody/HD-wallet provider —
 * see `CustodyProvider` in services/custody.ts, which is the only place the
 * rest of the app talks to.
 */
export function deriveAddress(secret: string, userId: string, currency: string, network: string): string {
  const digest = crypto.createHmac('sha256', secret).update(`${userId}:${currency}:${network}`).digest();
  switch (network) {
    case 'BITCOIN': {
      // bech32 data part uses its own restricted charset
      const charset = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
      let body = '';
      for (let i = 0; i < 38; i += 1) body += charset[digest[i % digest.length] % charset.length];
      return `bc1q${body}`;
    }
    case 'ERC20':
      return '0x' + digest.toString('hex').slice(0, 40);
    case 'TRC20':
      return 'T' + base58(digest, 33);
    default:
      throw new Error(`unsupported network ${network}`);
  }
}

export function mockTxHash(network: string, seed: string): string {
  const digest = crypto.createHash('sha256').update(`${network}:${seed}:${Date.now()}`).digest('hex');
  return network === 'BITCOIN' || network === 'TRC20' ? digest : `0x${digest}`;
}
