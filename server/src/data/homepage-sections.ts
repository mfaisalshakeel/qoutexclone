/**
 * Original marketing copy for the homepage's fixed sections (Phase 7 renders
 * them; this task's CMS is what makes them editable). Seeded and published so
 * there is real, original copy from day one rather than an empty draft.
 */
export const DEFAULT_HOMEPAGE_SECTIONS: Record<
  string,
  { title: string; subtitle?: string; body?: string }
> = {
  hero: {
    title: 'Trade the next tick, not the next quarter',
    subtitle: 'Pick a direction, set your stake, know your payout before you trade.',
    body: 'Currencies, crypto, commodities, stocks and indices — including markets that trade around the clock. Start with a free practice balance, no card required.',
  },
  markets_strip: {
    title: 'Live markets, live payouts',
    body: 'Every market on the platform, with its current payout shown up front — nothing hidden until after you commit.',
  },
  how_it_works: {
    title: 'Three steps, start to finish',
    body: '1. Choose a market and a direction. 2. Set your stake and an expiry. 3. Watch it settle — win or lose, you always know the outcome by the time you set.',
  },
  platform_showcase: {
    title: 'One terminal, every screen',
    subtitle: 'The full charting toolkit on desktop; a native-feeling terminal on your phone.',
  },
  features_grid: {
    title: 'Built for traders who watch the clock',
    body: 'Fast crypto deposits, OTC markets that never close, 20+ chart indicators, live tournaments, a free practice account, and a mobile terminal that keeps up.',
  },
  status_levels: {
    title: 'The more you trade, the more you keep',
    body: 'Status levels reward activity with a payout bonus, withdrawal priority and deposit bonuses — automatic, with no forms to fill in.',
  },
  tournaments_teaser: {
    title: 'Trade the leaderboard, not just the market',
    body: 'Join a tournament, get a fresh stack of chips, and climb the board against everyone else entered. Top finishers split a real-money prize pool.',
  },
  payment_methods: {
    title: 'Deposit your way',
    body: 'Crypto, card and e-wallet, with limits and fees shown before you commit to any of them.',
  },
  security: {
    title: 'Trade with your eyes open',
    body: 'Trading fixed-payout options carries real risk — you can lose your entire stake. Practice first, set your own limits, and never trade more than you can afford to lose.',
  },
  testimonials: {
    title: 'What traders say',
  },
  faq_accordion: {
    title: 'Questions, answered',
    subtitle: "Can't find yours? Our help centre has more, or reach support directly.",
  },
  final_cta: {
    title: 'Your first trade is on the house',
    subtitle: 'Practice with simulated funds, then deposit when you are ready.',
  },
  footer: {
    title: 'Quantex',
    body: 'Trading fixed-payout options carries risk and you can lose the money you put in.',
  },
};
