/**
 * The strength meter under the password field.
 *
 * Advice, not enforcement — the server holds the policy. What this is for is
 * telling someone *while they type* why a password is weak, so the rejection
 * never comes as a surprise after they press the button.
 */

export interface Strength {
  /** 0 (empty) to 4 (strong). */
  score: number;
  label: string;
  /** The single most useful thing they could do next, or null when strong. */
  hint: string | null;
}

const LABELS = ['Too short', 'Weak', 'Fair', 'Good', 'Strong'];

/** Characters that come from the keyboard in a row, forwards or backwards. */
const SEQUENCES = ['abcdefghijklmnopqrstuvwxyz', '01234567890', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm'];

function hasRun(password: string, length = 4): boolean {
  const lowered = password.toLowerCase();
  for (const sequence of SEQUENCES) {
    const backwards = [...sequence].reverse().join('');
    for (let index = 0; index + length <= sequence.length; index += 1) {
      if (lowered.includes(sequence.slice(index, index + length))) return true;
      if (lowered.includes(backwards.slice(index, index + length))) return true;
    }
  }
  // the same character over and over: aaaa, 1111
  return new RegExp(`(.)\\1{${length - 1},}`).test(password);
}

export function strength(password: string, context: { email?: string; name?: string } = {}): Strength {
  if (!password) return { score: 0, label: LABELS[0], hint: 'Use at least 8 characters' };

  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^\w\s]/].filter((pattern) => pattern.test(password)).length;

  let score = 0;
  if (password.length >= 8) score += 1;
  if (password.length >= 12) score += 1;
  if (classes >= 3) score += 1;
  if (password.length >= 16 || (classes === 4 && password.length >= 10)) score += 1;

  // guessable shapes cost a point rather than capping the score, so a long
  // passphrase that happens to contain "abcd" is not called weak
  if (hasRun(password)) score -= 1;

  const lowered = password.toLowerCase();
  const local = context.email?.split('@')[0]?.toLowerCase();
  const first = context.name?.trim().split(/\s+/)[0]?.toLowerCase();
  const personal =
    (!!local && local.length >= 4 && lowered.includes(local)) ||
    (!!first && first.length >= 4 && lowered.includes(first));
  if (personal) score = Math.min(score, 1);

  score = Math.max(0, Math.min(4, score));

  let hint: string | null = null;
  if (password.length < 8) hint = 'Use at least 8 characters';
  else if (personal) hint = 'Leave your name and email out of it';
  else if (hasRun(password)) hint = 'Avoid runs like "abcd" or "1111"';
  else if (classes < 3) hint = 'Mix upper case, lower case and numbers';
  else if (password.length < 12) hint = 'Longer is stronger — aim for 12 or more';

  return { score, label: LABELS[score], hint };
}
