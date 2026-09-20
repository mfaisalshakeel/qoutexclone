/**
 * What a password has to be before the server will store it.
 *
 * The meter in the browser is advice; this is the rule. Both exist because a
 * client can be skipped and a rule with no feedback is just a rejection.
 */

export interface PasswordPolicy {
  minLength: number;
  requireMixedCase: boolean;
  requireNumber: boolean;
  requireSymbol: boolean;
}

/**
 * The passwords that show up first in every credential-stuffing list. Short
 * on purpose: this is a floor, not a dictionary, and the length and class
 * rules do the rest.
 */
const COMMON = new Set([
  '123456',
  '12345678',
  '123456789',
  '1234567890',
  'password',
  'password1',
  'passw0rd',
  'qwerty',
  'qwerty123',
  'abc12345',
  'iloveyou',
  'admin123',
  'welcome1',
  'letmein1',
  'trustno1',
  'monkey12',
  'football',
  'baseball',
  'sunshine',
  'princess',
  'dragon12',
  'superman',
  'starwars',
  'quantex1',
]);

export interface PolicyResult {
  ok: boolean;
  /** Every reason it was refused, so the form can show them all at once. */
  problems: string[];
}

export function checkPassword(
  password: string,
  policy: PasswordPolicy,
  context: { email?: string; name?: string } = {},
): PolicyResult {
  const problems: string[] = [];

  if (password.length < policy.minLength) {
    problems.push(`Use at least ${policy.minLength} characters`);
  }
  if (policy.requireMixedCase && !(/[a-z]/.test(password) && /[A-Z]/.test(password))) {
    problems.push('Mix upper and lower case');
  }
  if (policy.requireNumber && !/\d/.test(password)) {
    problems.push('Include a number');
  }
  if (policy.requireSymbol && !/[^\w\s]/.test(password)) {
    problems.push('Include a symbol');
  }
  if (COMMON.has(password.toLowerCase())) {
    problems.push('That password is one of the most common ones in use');
  }

  // a password built out of the address or the name on the account is the
  // first thing anyone trying the door will attempt
  const lowered = password.toLowerCase();
  const local = context.email?.split('@')[0]?.toLowerCase();
  if (local && local.length >= 4 && lowered.includes(local)) {
    problems.push('Do not use your email address in your password');
  }
  const first = context.name?.trim().split(/\s+/)[0]?.toLowerCase();
  if (first && first.length >= 4 && lowered.includes(first)) {
    problems.push('Do not use your name in your password');
  }

  return { ok: problems.length === 0, problems };
}
