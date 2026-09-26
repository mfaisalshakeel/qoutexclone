/**
 * Illustrative trader quotes the homepage ships with, written in-house rather
 * than attributed to real customers — clearly the platform's own placeholder
 * marketing copy, the same spirit as the placeholder legal text, for an
 * operator to replace with real reviews once they have them.
 */
export const DEFAULT_TESTIMONIALS: {
  name: string;
  role: string;
  quote: string;
  avatar: string;
  rating: number;
  sortOrder: number;
}[] = [
  {
    name: 'Amara O.',
    role: 'Trading since 2024',
    quote:
      'The practice account is what sold me — I ran the same strategy on ten thousand in play money for a month before I ever deposited. When I moved to real trading nothing about the terminal felt different.',
    avatar: 'emerald',
    rating: 5,
    sortOrder: 10,
  },
  {
    name: 'Daniel K.',
    role: 'Trading since 2023',
    quote:
      "OTC markets trading through the weekend changed how I plan my week. I'm not stuck waiting for Monday's open to act on something I noticed on Saturday.",
    avatar: 'sky',
    rating: 5,
    sortOrder: 20,
  },
  {
    name: 'Priya S.',
    role: 'Trading since 2024',
    quote:
      'Crypto withdrawals actually arrive when the fee estimate says they will. Small thing, but it is the reason I stopped comparing platforms and just stayed here.',
    avatar: 'violet',
    rating: 5,
    sortOrder: 30,
  },
  {
    name: 'Marco T.',
    role: 'Trading since 2022',
    quote:
      'Tournaments got me trading pairs I would never have touched otherwise. Climbing a leaderboard with chips instead of my own balance took the pressure off and taught me more than a year of solo trading did.',
    avatar: 'amber',
    rating: 4,
    sortOrder: 40,
  },
];
