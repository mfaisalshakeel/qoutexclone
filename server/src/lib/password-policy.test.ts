import { describe, expect, it } from 'vitest';
import { checkPassword, type PasswordPolicy } from './password-policy.js';

const POLICY: PasswordPolicy = {
  minLength: 8,
  requireMixedCase: true,
  requireNumber: true,
  requireSymbol: false,
};

describe('checkPassword', () => {
  it('accepts a password that meets every rule', () => {
    expect(checkPassword('Harbour7Lantern', POLICY)).toEqual({ ok: true, problems: [] });
  });

  it('reports every failure at once rather than one at a time', () => {
    const result = checkPassword('short', POLICY);
    expect(result.ok).toBe(false);
    expect(result.problems).toHaveLength(3);
  });

  it('enforces length, case and digits separately', () => {
    expect(checkPassword('alllowercase1', POLICY).problems).toContain('Mix upper and lower case');
    expect(checkPassword('NoDigitsHere', POLICY).problems).toContain('Include a number');
    expect(checkPassword('Ab1cdef', POLICY).problems).toContain('Use at least 8 characters');
  });

  it('only asks for a symbol when the policy says so', () => {
    expect(checkPassword('Harbour7Lantern', { ...POLICY, requireSymbol: true }).problems).toContain(
      'Include a symbol',
    );
    expect(checkPassword('Harbour7Lantern!', { ...POLICY, requireSymbol: true }).ok).toBe(true);
  });

  it('refuses the passwords everyone tries first', () => {
    expect(checkPassword('Password1', { ...POLICY, minLength: 8 }).ok).toBe(false);
    expect(checkPassword('QWERTY123', { ...POLICY, requireMixedCase: false }).ok).toBe(false);
  });

  it('refuses a password built from the address or the name', () => {
    expect(checkPassword('Trader1Account', POLICY, { email: 'trader@example.test' }).problems).toContain(
      'Do not use your email address in your password',
    );
    expect(checkPassword('Amelia7Pass', POLICY, { name: 'Amelia Stone' }).problems).toContain(
      'Do not use your name in your password',
    );
  });

  it('ignores a short local part, which would otherwise match everything', () => {
    expect(checkPassword('Abcdefg1', POLICY, { email: 'ab@example.test' }).ok).toBe(true);
  });
});
