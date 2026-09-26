/**
 * The help-centre FAQ the platform ships with, published so Phase 7's help
 * centre has real answers to render from day one. An operator edits, adds to,
 * or unpublishes any of these from the content CMS.
 */
export const DEFAULT_FAQ: {
  category: string;
  question: string;
  answer: string;
  sortOrder: number;
}[] = [
  {
    category: 'Getting started',
    question: 'How do I open my first position?',
    answer:
      'Pick a market, choose Higher or Lower, set your stake and an expiry, then confirm. The payout percentage is shown before you trade and is locked in the moment your position opens.',
    sortOrder: 10,
  },
  {
    category: 'Getting started',
    question: 'What is the practice account?',
    answer:
      'A simulated balance you can trade with no real money at risk, on the same markets and terminal as live trading. It is the fastest way to learn how the platform behaves before depositing.',
    sortOrder: 20,
  },
  {
    category: 'Deposits & withdrawals',
    question: 'How long does a deposit take to arrive?',
    answer:
      'Crypto deposits credit automatically once the network confirms them — usually a few minutes, depending on the network. Card and e-wallet deposits are typically instant.',
    sortOrder: 10,
  },
  {
    category: 'Deposits & withdrawals',
    question: 'Why is my withdrawal pending review?',
    answer:
      "Some withdrawals need identity verification first, especially above a threshold or on a new account. Once your documents are approved, pending withdrawals are released in the order they were requested.",
    sortOrder: 20,
  },
  {
    category: 'Trading',
    question: 'What happens if the market is closed?',
    answer:
      "Non-OTC markets (currencies, stocks, indices, commodities) follow real trading-session hours and show a closed state outside them. Their OTC twin, where offered, trades 24/7 on a broker-generated feed.",
    sortOrder: 10,
  },
  {
    category: 'Trading',
    question: 'How is the payout percentage decided?',
    answer:
      "Each market has a base payout, adjusted for time of day, volatility and any active status-level bonus. It never depends on how other traders are positioned.",
    sortOrder: 20,
  },
  {
    category: 'Tournaments',
    question: 'What are tournament chips?',
    answer:
      'A separate balance, just for that event, that never mixes with your practice or live money. You trade it exactly like a live account; the leaderboard ranks entrants by chip balance and pays real prizes from the pool at the end.',
    sortOrder: 10,
  },
  {
    category: 'Account & security',
    question: 'How do I turn on two-factor authentication?',
    answer:
      "From Account → Security, scan the QR code with an authenticator app and enter the six-digit code to confirm. Save the backup codes somewhere safe — they are the only way back in if you lose the device.",
    sortOrder: 10,
  },
];
