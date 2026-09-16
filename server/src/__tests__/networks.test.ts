import { describe, expect, it } from 'vitest';
import { NETWORKS, deriveAddress, findNetwork, isValidAddress } from '../lib/crypto-networks.js';

describe('crypto networks', () => {
  it('accepts real-world address formats', () => {
    expect(isValidAddress('BTC', 'BITCOIN', '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa')).toBe(true);
    expect(isValidAddress('BTC', 'BITCOIN', 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq')).toBe(true);
    expect(isValidAddress('USDT', 'ERC20', '0xdAC17F958D2ee523a2206206994597C13D831ec7')).toBe(true);
    expect(isValidAddress('USDT', 'TRC20', 'TJRyWwFs9wTFGZg3JbrVriFbNfCug5tDeC')).toBe(true);
  });

  it('rejects malformed or cross-network addresses', () => {
    expect(isValidAddress('BTC', 'BITCOIN', 'not-an-address')).toBe(false);
    expect(isValidAddress('USDT', 'ERC20', 'TJRyWwFs9wTFGZg3JbrVriFbNfCug5tDeC')).toBe(false);
    expect(isValidAddress('USDT', 'TRC20', '0xdAC17F958D2ee523a2206206994597C13D831ec7')).toBe(false);
    expect(isValidAddress('BTC', 'TRC20', 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq')).toBe(false);
  });

  it('derives stable addresses that pass their own network validation', () => {
    for (const spec of NETWORKS) {
      const address = deriveAddress('secret', 'user-1', spec.currency, spec.network);
      expect(isValidAddress(spec.currency, spec.network, address), `${spec.currency}/${spec.network}: ${address}`).toBe(true);
      expect(deriveAddress('secret', 'user-1', spec.currency, spec.network)).toBe(address);
    }
  });

  it('gives each user a different address', () => {
    const a = deriveAddress('secret', 'user-1', 'USDT', 'TRC20');
    const b = deriveAddress('secret', 'user-2', 'USDT', 'TRC20');
    expect(a).not.toBe(b);
  });

  it('exposes every supported currency/network pair', () => {
    expect(findNetwork('USDT', 'TRC20')).toBeDefined();
    expect(findNetwork('USDT', 'BITCOIN')).toBeUndefined();
  });
});
