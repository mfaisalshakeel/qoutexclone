import { env } from '../env.js';
import { deriveAddress, mockTxHash } from '../lib/crypto-networks.js';

export interface PayoutRequest {
  currency: string;
  network: string;
  address: string;
  amount: string; // decimal string in crypto units
  reference: string;
}

/**
 * Everything the platform needs from a wallet back end. Swapping the mock for a
 * real custody service (node, exchange sub-account, BitGo/Fireblocks/Tatum…)
 * means implementing this interface and exporting it as `custody`.
 */
export interface CustodyProvider {
  readonly name: string;
  getDepositAddress(
    userId: string,
    currency: string,
    network: string,
  ): Promise<{ address: string; memo?: string }>;
  sendPayout(request: PayoutRequest): Promise<{ txHash: string }>;
}

/** Deterministic in-process provider used for development and demos. */
export class MockCustodyProvider implements CustodyProvider {
  readonly name = 'mock';

  constructor(private secret: string) {}

  async getDepositAddress(userId: string, currency: string, network: string) {
    return { address: deriveAddress(this.secret, userId, currency, network) };
  }

  async sendPayout(request: PayoutRequest) {
    return { txHash: mockTxHash(request.network, request.reference) };
  }
}

export const custody: CustodyProvider = new MockCustodyProvider(env.jwtSecret);
