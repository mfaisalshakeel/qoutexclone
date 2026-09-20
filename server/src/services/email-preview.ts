import {
  depositCredited,
  kycResult,
  newDeviceAlert,
  resetPassword,
  tournamentResult,
  twoFactorChanged,
  verifyEmail,
  withdrawalUpdate,
  type RenderedEmail,
} from './email-templates.js';

/**
 * Every template, rendered with sample data.
 *
 * The back office needs to show what a message looks like before anyone
 * receives one, and a template with no preview is a template nobody checks.
 * The samples are invented and obviously so — no real account is read here.
 */

export interface TemplatePreview {
  id: string;
  label: string;
  /** What causes the platform to send it. */
  when: string;
  email: RenderedEmail;
}

const SAMPLE_NAME = 'Amelia Stone';
const SITE = 'https://quantex.example';

export function previewAll(): TemplatePreview[] {
  return [
    {
      id: 'verify-email',
      label: 'Confirm your address',
      when: 'On registration, and whenever the trader asks for the link again.',
      email: verifyEmail({ name: SAMPLE_NAME, url: `${SITE}/verify-email?token=sample`, hours: 48 }),
    },
    {
      id: 'reset-password',
      label: 'Reset your password',
      when: 'When someone asks for a reset link.',
      email: resetPassword({ name: SAMPLE_NAME, url: `${SITE}/reset-password?token=sample`, minutes: 30 }),
    },
    {
      id: 'new-device',
      label: 'New device signed in',
      when: 'A successful sign-in from a browser and network the account has not used.',
      email: newDeviceAlert({
        name: SAMPLE_NAME,
        device: 'Chrome on Windows',
        ip: '81.2.69.142',
        at: new Date('2026-09-20T09:14:00Z'),
        url: `${SITE}/account/security`,
      }),
    },
    {
      id: 'two-factor-on',
      label: 'Two-factor turned on',
      when: 'Enrolment is confirmed. The off variant is sent when it is removed.',
      email: twoFactorChanged({ name: SAMPLE_NAME, enabled: true, url: `${SITE}/account/security` }),
    },
    {
      id: 'deposit-credited',
      label: 'Deposit credited',
      when: 'A deposit reaches the required confirmations and the balance moves.',
      email: depositCredited({
        name: SAMPLE_NAME,
        amount: 25_000,
        bonus: 2_500,
        currency: 'USDT',
        network: 'TRC-20',
        url: `${SITE}/wallet`,
      }),
    },
    {
      id: 'withdrawal-completed',
      label: 'Withdrawal update',
      when: 'A withdrawal is approved, sent, paid, declined or cancelled.',
      email: withdrawalUpdate({
        name: SAMPLE_NAME,
        status: 'COMPLETED',
        amount: 120_000,
        note: null,
        url: `${SITE}/wallet?tab=withdraw`,
      }),
    },
    {
      id: 'kyc-approved',
      label: 'Identity check result',
      when: 'An administrator approves or declines a verification request.',
      email: kycResult({ name: SAMPLE_NAME, approved: true, reason: null, url: `${SITE}/account` }),
    },
    {
      id: 'tournament-result',
      label: 'Tournament result',
      when: 'A tournament finishes, to everyone who entered.',
      email: tournamentResult({
        name: SAMPLE_NAME,
        tournament: 'Friday Sprint',
        place: 2,
        prize: 50_000,
        url: `${SITE}/tournaments`,
      }),
    },
  ];
}
