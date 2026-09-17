import type { AssetClass } from './markets.js';

export interface ScheduleSeed {
  key: string;
  name: string;
  note: string;
  /** minutes from midnight UTC; closeMinute may exceed 1440 */
  windows: { dayOfWeek: number; openMinute: number; closeMinute: number }[];
  holidays: { date: string; name: string }[];
}

const hm = (hours: number, minutes = 0) => hours * 60 + minutes;

/** Sunday 21:00 → Friday 21:00 UTC, continuous. */
const forexWindows = [
  { dayOfWeek: 0, openMinute: hm(21), closeMinute: hm(24) },
  { dayOfWeek: 1, openMinute: 0, closeMinute: hm(24) },
  { dayOfWeek: 2, openMinute: 0, closeMinute: hm(24) },
  { dayOfWeek: 3, openMinute: 0, closeMinute: hm(24) },
  { dayOfWeek: 4, openMinute: 0, closeMinute: hm(24) },
  { dayOfWeek: 5, openMinute: 0, closeMinute: hm(21) },
];

const weekdays = [1, 2, 3, 4, 5];

/**
 * Starting calendars. Dates are the fixed-date closures that apply every year
 * on these venues; operators add the moving ones (Easter, Thanksgiving) from
 * the admin screen, which is why holidays are data rather than code.
 */
export const SCHEDULES: ScheduleSeed[] = [
  {
    key: 'forex-24-5',
    name: 'Forex 24/5',
    note: 'Opens Sunday 21:00 UTC, closes Friday 21:00 UTC.',
    windows: forexWindows,
    holidays: [
      { date: '2026-01-01', name: "New Year's Day" },
      { date: '2026-12-25', name: 'Christmas Day' },
    ],
  },
  {
    key: 'metals-energy',
    name: 'Metals and energy',
    note: 'Follows the forex week with a daily maintenance break at 21:00–22:00 UTC.',
    windows: [
      { dayOfWeek: 0, openMinute: hm(22), closeMinute: hm(24) },
      ...[1, 2, 3, 4].map((dayOfWeek) => ({ dayOfWeek, openMinute: 0, closeMinute: hm(21) })),
      ...[1, 2, 3, 4].map((dayOfWeek) => ({ dayOfWeek, openMinute: hm(22), closeMinute: hm(24) })),
      { dayOfWeek: 5, openMinute: 0, closeMinute: hm(21) },
    ],
    holidays: [
      { date: '2026-01-01', name: "New Year's Day" },
      { date: '2026-12-25', name: 'Christmas Day' },
    ],
  },
  {
    key: 'us-equities',
    name: 'US equities',
    note: 'Regular session 13:30–20:00 UTC, Monday to Friday.',
    windows: weekdays.map((dayOfWeek) => ({ dayOfWeek, openMinute: hm(13, 30), closeMinute: hm(20) })),
    holidays: [
      { date: '2026-01-01', name: "New Year's Day" },
      { date: '2026-06-19', name: 'Juneteenth' },
      { date: '2026-07-03', name: 'Independence Day (observed)' },
      { date: '2026-12-25', name: 'Christmas Day' },
    ],
  },
  {
    key: 'us-indices',
    name: 'US index CFDs',
    note: 'Nearly round the clock on weekdays, with a daily break at 21:00–22:00 UTC.',
    windows: [
      { dayOfWeek: 0, openMinute: hm(22), closeMinute: hm(24) },
      ...[1, 2, 3, 4].map((dayOfWeek) => ({ dayOfWeek, openMinute: 0, closeMinute: hm(21) })),
      ...[1, 2, 3, 4].map((dayOfWeek) => ({ dayOfWeek, openMinute: hm(22), closeMinute: hm(24) })),
      { dayOfWeek: 5, openMinute: 0, closeMinute: hm(21) },
    ],
    holidays: [
      { date: '2026-01-01', name: "New Year's Day" },
      { date: '2026-12-25', name: 'Christmas Day' },
    ],
  },
  {
    key: 'europe-indices',
    name: 'European index CFDs',
    note: 'Regular session 07:00–15:30 UTC, Monday to Friday.',
    windows: weekdays.map((dayOfWeek) => ({ dayOfWeek, openMinute: hm(7), closeMinute: hm(15, 30) })),
    holidays: [
      { date: '2026-01-01', name: "New Year's Day" },
      { date: '2026-12-25', name: 'Christmas Day' },
      { date: '2026-12-26', name: 'Boxing Day' },
    ],
  },
];

/** Which calendar a market trades on. OTC and crypto stay on no schedule. */
export function scheduleKeyFor(market: {
  assetClass: AssetClass;
  isOtc: boolean;
  symbol: string;
}): string | null {
  if (market.isOtc) return null;
  switch (market.assetClass) {
    case 'CURRENCY':
      return 'forex-24-5';
    case 'COMMODITY':
      return 'metals-energy';
    case 'STOCK':
      return 'us-equities';
    case 'INDEX':
      return market.symbol.startsWith('US') ? 'us-indices' : 'europe-indices';
    case 'CRYPTO':
    default:
      return null; // crypto never closes
  }
}
