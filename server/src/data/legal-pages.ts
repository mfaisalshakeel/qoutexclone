/**
 * The five fixed legal documents, seeded so the pages are never blank.
 *
 * Every one of these is placeholder text, marked as such in its own first
 * line, per CLAUDE.md: real-money launch needs licensing, KYC/AML and legal
 * pages drafted and reviewed by the owner's own counsel. An operator edits
 * and publishes the real copy from the content CMS; this is only what ships
 * before that happens, so the pages are never simply empty.
 */
export const DEFAULT_LEGAL_PAGES: Record<string, string> = {
  terms: `> **Placeholder legal text — not legal advice.** Replace this page with counsel-reviewed Terms of Service before accepting real money.

## Terms of Service

These terms govern your use of this platform. By creating an account you agree to trade at your own risk, to provide accurate information, and to use the platform only where doing so is lawful for you.

### Eligibility

You must be of legal age in your jurisdiction and not resident in a country where binary-options trading is restricted or prohibited.

### Accounts

One account per person. You are responsible for keeping your credentials and two-factor codes secure, and for every action taken from your account.

### Trading

Positions are fixed-payout: you choose a direction and a stake, and the platform settles the position against the market price at expiry, at the payout percentage locked in when you opened it. Past results do not predict future ones.

### Funds

Deposits and withdrawals are subject to the limits, fees and verification requirements shown in your wallet. The platform may hold a withdrawal pending identity verification or a fraud review.

### Termination

The platform may suspend or close an account that violates these terms, engages in fraud, or where required by law.`,

  privacy: `> **Placeholder legal text — not legal advice.** Replace this page with counsel-reviewed Privacy Policy before accepting real money.

## Privacy Policy

We collect the information needed to run your account: your name, email, country, trading activity, and — where verification is required — identity documents.

### How it is used

To operate your account, process deposits and withdrawals, meet legal obligations (including AML/KYC), and communicate with you about your account.

### How it is protected

Passwords are stored hashed, never in plain text. Identity documents are stored securely and accessed only for verification and compliance.

### Your rights

You can request a copy of the data held about you, ask for it to be corrected, and — subject to our legal retention obligations — ask for it to be deleted.

### Third parties

We use payment providers to process deposits and withdrawals, and an email provider to send account notifications. We do not sell your data.`,

  'risk-disclosure': `> **Placeholder legal text — not legal advice.** Replace this page with counsel-reviewed Risk Disclosure before accepting real money.

## Risk Disclosure

Trading fixed-payout options carries a high level of risk and is not suitable for everyone.

### You can lose your entire stake

Unlike many forms of investing, a losing position pays nothing back. Only trade with money you can afford to lose.

### Past performance is not a guide

No pattern, indicator or strategy guarantees a future result. Markets, including the platform's own OTC markets, move unpredictably.

### Practice first

A practice account is available with simulated funds, with no real-money risk, to learn how the platform and its instruments behave before trading with real money.

### Responsible trading tools

Deposit limits, loss limits, and self-exclusion are available from your account settings. Use them if trading is affecting you negatively.`,

  'aml-kyc': `> **Placeholder legal text — not legal advice.** Replace this page with counsel-reviewed AML/KYC Policy before accepting real money.

## Anti-Money Laundering & Know Your Customer Policy

The platform verifies the identity of its traders and monitors transactions to prevent money laundering, terrorist financing, and fraud.

### Verification

Above certain deposit or withdrawal thresholds, or when otherwise required, you will be asked to submit a government-issued photo ID and, where applicable, proof of address. Withdrawals may be held until verification is complete.

### Monitoring

Deposits, withdrawals and trading activity are monitored for patterns consistent with money laundering or fraud. Suspicious activity is reported to the relevant authorities where required by law.

### Source of funds

The platform may request evidence of the source of funds for unusually large deposits.`,

  'cookie-policy': `> **Placeholder legal text — not legal advice.** Replace this page with counsel-reviewed Cookie Policy before accepting real money.

## Cookie Policy

This platform uses cookies and similar technology to keep you signed in, remember your preferences, and understand how the platform is used.

### Essential cookies

Required for sign-in and core functionality. The platform does not work correctly without these.

### Preference cookies

Remember settings such as your chosen theme, layout and language.

### Analytics cookies

Help us understand how the platform is used, in aggregate, so we can improve it.

You can control cookies through your browser settings. Blocking essential cookies will prevent you from signing in.`,
};
