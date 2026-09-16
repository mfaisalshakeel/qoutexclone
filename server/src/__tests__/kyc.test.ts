import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

async function loadGate(envPatch: Record<string, string>) {
  vi.resetModules();
  for (const [key, value] of Object.entries(envPatch)) process.env[key] = value;
  const { kycBlocksWithdrawal } = await import('../services/kyc.js');
  return kycBlocksWithdrawal;
}

describe('kyc withdrawal gate', () => {
  const original = { ...process.env };
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    process.env = { ...original };
  });

  it('lets everything through when verification is not required', async () => {
    const gate = await loadGate({ REQUIRE_KYC_FOR_WITHDRAWAL: 'false' });
    expect(gate('NOT_SUBMITTED', 1_000_000)).toBe(false);
  });

  it('blocks unverified traders when required', async () => {
    const gate = await loadGate({ REQUIRE_KYC_FOR_WITHDRAWAL: 'true', KYC_WITHDRAWAL_THRESHOLD_USD: '0' });
    expect(gate('NOT_SUBMITTED', 100)).toBe(true);
    expect(gate('PENDING', 100)).toBe(true);
    expect(gate('REJECTED', 100)).toBe(true);
    expect(gate('APPROVED', 100_000)).toBe(false);
  });

  it('only blocks above the threshold', async () => {
    const gate = await loadGate({ REQUIRE_KYC_FOR_WITHDRAWAL: 'true', KYC_WITHDRAWAL_THRESHOLD_USD: '100' });
    expect(gate('NOT_SUBMITTED', 9_999)).toBe(false); // $99.99
    expect(gate('NOT_SUBMITTED', 10_000)).toBe(false); // exactly $100
    expect(gate('NOT_SUBMITTED', 10_001)).toBe(true); // over the line
  });
});
