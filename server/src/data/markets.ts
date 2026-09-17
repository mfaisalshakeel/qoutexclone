/**
 * The market catalogue.
 *
 * `volatility` is a per-minute standard deviation of returns, which is how the
 * price engine consumes it (see engine/feed.ts). Base prices are plausible
 * mid-2020s levels; the simulator walks from there and a live feed overrides
 * them entirely. Payouts are starting points — operators tune them per market.
 *
 * Symbols are the stable internal key (`EURUSD`, `BTCUSDT`, `EURUSD_OTC`);
 * `pair` is what a trader sees.
 */

export type AssetClass = 'CURRENCY' | 'CRYPTO' | 'COMMODITY' | 'STOCK' | 'INDEX';

export interface MarketSpec {
  symbol: string;
  name: string;
  pair: string;
  assetClass: AssetClass;
  base: string;
  quote: string;
  feedSymbol: string;
  isOtc: boolean;
  payoutPct: number;
  precision: number;
  pipSize: number;
  basePrice: number;
  volatility: number;
  icon: string;
  minStake?: number;
  maxStake?: number;
}

interface Draft {
  base: string;
  quote: string;
  name: string;
  basePrice: number;
  /** per-minute sigma */
  volatility: number;
  precision: number;
  payoutPct: number;
  /** generate an OTC twin of this market */
  otc?: boolean;
  feedSymbol?: string;
  symbol?: string;
  icon?: string;
}

const pipFor = (precision: number) => Number((10 ** -precision).toFixed(precision));

/* ------------------------------- currencies ------------------------------- */
// Majors sit at the low end of the volatility range, crosses a little above,
// and exotics higher still. JPY pairs quote to 3 decimals, everything else 5.
const CURRENCIES: Draft[] = [
  {
    base: 'EUR',
    quote: 'USD',
    name: 'Euro / US Dollar',
    basePrice: 1.0854,
    volatility: 0.00022,
    precision: 5,
    payoutPct: 87,
  },
  {
    base: 'GBP',
    quote: 'USD',
    name: 'British Pound / US Dollar',
    basePrice: 1.2712,
    volatility: 0.00026,
    precision: 5,
    payoutPct: 86,
  },
  {
    base: 'USD',
    quote: 'JPY',
    name: 'US Dollar / Japanese Yen',
    basePrice: 151.42,
    volatility: 0.00025,
    precision: 3,
    payoutPct: 86,
  },
  {
    base: 'USD',
    quote: 'CHF',
    name: 'US Dollar / Swiss Franc',
    basePrice: 0.9045,
    volatility: 0.00023,
    precision: 5,
    payoutPct: 85,
  },
  {
    base: 'AUD',
    quote: 'USD',
    name: 'Australian Dollar / US Dollar',
    basePrice: 0.6588,
    volatility: 0.00028,
    precision: 5,
    payoutPct: 85,
  },
  {
    base: 'USD',
    quote: 'CAD',
    name: 'US Dollar / Canadian Dollar',
    basePrice: 1.3562,
    volatility: 0.00024,
    precision: 5,
    payoutPct: 85,
  },
  {
    base: 'NZD',
    quote: 'USD',
    name: 'New Zealand Dollar / US Dollar',
    basePrice: 0.6042,
    volatility: 0.0003,
    precision: 5,
    payoutPct: 84,
  },
  {
    base: 'EUR',
    quote: 'GBP',
    name: 'Euro / British Pound',
    basePrice: 0.8538,
    volatility: 0.00021,
    precision: 5,
    payoutPct: 84,
  },
  {
    base: 'EUR',
    quote: 'JPY',
    name: 'Euro / Japanese Yen',
    basePrice: 164.35,
    volatility: 0.00029,
    precision: 3,
    payoutPct: 84,
  },
  {
    base: 'GBP',
    quote: 'JPY',
    name: 'British Pound / Japanese Yen',
    basePrice: 192.48,
    volatility: 0.00034,
    precision: 3,
    payoutPct: 83,
  },
  {
    base: 'EUR',
    quote: 'CHF',
    name: 'Euro / Swiss Franc',
    basePrice: 0.9815,
    volatility: 0.0002,
    precision: 5,
    payoutPct: 83,
  },
  {
    base: 'AUD',
    quote: 'JPY',
    name: 'Australian Dollar / Japanese Yen',
    basePrice: 99.75,
    volatility: 0.00033,
    precision: 3,
    payoutPct: 83,
  },
  {
    base: 'CAD',
    quote: 'JPY',
    name: 'Canadian Dollar / Japanese Yen',
    basePrice: 111.64,
    volatility: 0.0003,
    precision: 3,
    payoutPct: 82,
  },
  {
    base: 'CHF',
    quote: 'JPY',
    name: 'Swiss Franc / Japanese Yen',
    basePrice: 167.41,
    volatility: 0.00031,
    precision: 3,
    payoutPct: 82,
  },
  {
    base: 'EUR',
    quote: 'AUD',
    name: 'Euro / Australian Dollar',
    basePrice: 1.6475,
    volatility: 0.00027,
    precision: 5,
    payoutPct: 82,
  },
  {
    base: 'EUR',
    quote: 'CAD',
    name: 'Euro / Canadian Dollar',
    basePrice: 1.4718,
    volatility: 0.00025,
    precision: 5,
    payoutPct: 82,
  },
  {
    base: 'GBP',
    quote: 'AUD',
    name: 'British Pound / Australian Dollar',
    basePrice: 1.9294,
    volatility: 0.0003,
    precision: 5,
    payoutPct: 81,
  },
  {
    base: 'GBP',
    quote: 'CAD',
    name: 'British Pound / Canadian Dollar',
    basePrice: 1.7235,
    volatility: 0.00028,
    precision: 5,
    payoutPct: 81,
  },
  {
    base: 'AUD',
    quote: 'CAD',
    name: 'Australian Dollar / Canadian Dollar',
    basePrice: 0.8934,
    volatility: 0.00024,
    precision: 5,
    payoutPct: 81,
  },
  {
    base: 'AUD',
    quote: 'NZD',
    name: 'Australian Dollar / New Zealand Dollar',
    basePrice: 1.0903,
    volatility: 0.00022,
    precision: 5,
    payoutPct: 81,
  },
  {
    base: 'NZD',
    quote: 'JPY',
    name: 'New Zealand Dollar / Japanese Yen',
    basePrice: 91.46,
    volatility: 0.00034,
    precision: 3,
    payoutPct: 80,
  },
  {
    base: 'USD',
    quote: 'SGD',
    name: 'US Dollar / Singapore Dollar',
    basePrice: 1.3462,
    volatility: 0.00018,
    precision: 5,
    payoutPct: 80,
  },
  {
    base: 'USD',
    quote: 'MXN',
    name: 'US Dollar / Mexican Peso',
    basePrice: 16.742,
    volatility: 0.00055,
    precision: 4,
    payoutPct: 80,
  },
  {
    base: 'USD',
    quote: 'ZAR',
    name: 'US Dollar / South African Rand',
    basePrice: 18.624,
    volatility: 0.0006,
    precision: 4,
    payoutPct: 79,
  },
  {
    base: 'USD',
    quote: 'TRY',
    name: 'US Dollar / Turkish Lira',
    basePrice: 32.184,
    volatility: 0.0008,
    precision: 4,
    payoutPct: 78,
  },
].map((draft) => ({ ...draft, otc: true }));

/* --------------------------------- crypto --------------------------------- */
// Quoted against USDT, which is what the exchange feed actually prices.
const CRYPTO: Draft[] = [
  {
    base: 'BTC',
    quote: 'USDT',
    name: 'Bitcoin',
    basePrice: 64250,
    volatility: 0.0012,
    precision: 2,
    payoutPct: 87,
    otc: true,
  },
  {
    base: 'ETH',
    quote: 'USDT',
    name: 'Ethereum',
    basePrice: 3145.5,
    volatility: 0.0016,
    precision: 2,
    payoutPct: 86,
    otc: true,
  },
  {
    base: 'SOL',
    quote: 'USDT',
    name: 'Solana',
    basePrice: 148.2,
    volatility: 0.0025,
    precision: 3,
    payoutPct: 84,
  },
  {
    base: 'BNB',
    quote: 'USDT',
    name: 'BNB',
    basePrice: 592.4,
    volatility: 0.0015,
    precision: 2,
    payoutPct: 82,
  },
  {
    base: 'XRP',
    quote: 'USDT',
    name: 'XRP',
    basePrice: 0.5271,
    volatility: 0.0022,
    precision: 5,
    payoutPct: 81,
  },
  {
    base: 'DOGE',
    quote: 'USDT',
    name: 'Dogecoin',
    basePrice: 0.1284,
    volatility: 0.003,
    precision: 6,
    payoutPct: 80,
  },
  {
    base: 'ADA',
    quote: 'USDT',
    name: 'Cardano',
    basePrice: 0.4382,
    volatility: 0.0025,
    precision: 5,
    payoutPct: 80,
  },
  {
    base: 'LTC',
    quote: 'USDT',
    name: 'Litecoin',
    basePrice: 71.63,
    volatility: 0.0018,
    precision: 2,
    payoutPct: 79,
  },
  {
    base: 'TON',
    quote: 'USDT',
    name: 'Toncoin',
    basePrice: 6.84,
    volatility: 0.0026,
    precision: 4,
    payoutPct: 78,
  },
  {
    base: 'AVAX',
    quote: 'USDT',
    name: 'Avalanche',
    basePrice: 27.41,
    volatility: 0.0026,
    precision: 3,
    payoutPct: 78,
  },
  {
    base: 'TRX',
    quote: 'USDT',
    name: 'TRON',
    basePrice: 0.1187,
    volatility: 0.0019,
    precision: 5,
    payoutPct: 78,
  },
  {
    base: 'LINK',
    quote: 'USDT',
    name: 'Chainlink',
    basePrice: 14.62,
    volatility: 0.0024,
    precision: 3,
    payoutPct: 78,
  },
];

/* ------------------------------- commodities ------------------------------ */
const COMMODITIES: Draft[] = [
  {
    symbol: 'XAUUSD',
    base: 'XAU',
    quote: 'USD',
    name: 'Gold',
    basePrice: 2318.4,
    volatility: 0.0006,
    precision: 2,
    payoutPct: 85,
    otc: true,
    icon: 'AU',
  },
  {
    symbol: 'XAGUSD',
    base: 'XAG',
    quote: 'USD',
    name: 'Silver',
    basePrice: 27.42,
    volatility: 0.0011,
    precision: 3,
    payoutPct: 83,
    otc: true,
    icon: 'AG',
  },
  {
    symbol: 'USOUSD',
    base: 'USO',
    quote: 'USD',
    name: 'Crude Oil (WTI)',
    basePrice: 78.35,
    volatility: 0.0013,
    precision: 2,
    payoutPct: 82,
    otc: true,
    icon: 'OIL',
  },
];

/* --------------------------------- stocks --------------------------------- */
const STOCKS: Draft[] = [
  {
    symbol: 'AAPL',
    base: 'AAPL',
    quote: 'USD',
    name: 'Apple',
    basePrice: 189.42,
    volatility: 0.0009,
    precision: 2,
    payoutPct: 82,
  },
  {
    symbol: 'MSFT',
    base: 'MSFT',
    quote: 'USD',
    name: 'Microsoft',
    basePrice: 421.65,
    volatility: 0.0008,
    precision: 2,
    payoutPct: 82,
  },
  {
    symbol: 'NVDA',
    base: 'NVDA',
    quote: 'USD',
    name: 'NVIDIA',
    basePrice: 884.2,
    volatility: 0.0016,
    precision: 2,
    payoutPct: 84,
    otc: true,
  },
  {
    symbol: 'AMZN',
    base: 'AMZN',
    quote: 'USD',
    name: 'Amazon',
    basePrice: 178.24,
    volatility: 0.001,
    precision: 2,
    payoutPct: 81,
  },
  {
    symbol: 'GOOGL',
    base: 'GOOGL',
    quote: 'USD',
    name: 'Alphabet',
    basePrice: 152.38,
    volatility: 0.001,
    precision: 2,
    payoutPct: 81,
  },
  {
    symbol: 'META',
    base: 'META',
    quote: 'USD',
    name: 'Meta Platforms',
    basePrice: 486.75,
    volatility: 0.0013,
    precision: 2,
    payoutPct: 81,
  },
  {
    symbol: 'TSLA',
    base: 'TSLA',
    quote: 'USD',
    name: 'Tesla',
    basePrice: 172.63,
    volatility: 0.0019,
    precision: 2,
    payoutPct: 83,
    otc: true,
  },
  {
    symbol: 'JPM',
    base: 'JPM',
    quote: 'USD',
    name: 'JPMorgan Chase',
    basePrice: 196.84,
    volatility: 0.0009,
    precision: 2,
    payoutPct: 80,
  },
  {
    symbol: 'V',
    base: 'V',
    quote: 'USD',
    name: 'Visa',
    basePrice: 277.31,
    volatility: 0.0008,
    precision: 2,
    payoutPct: 80,
  },
  {
    symbol: 'NFLX',
    base: 'NFLX',
    quote: 'USD',
    name: 'Netflix',
    basePrice: 612.48,
    volatility: 0.0014,
    precision: 2,
    payoutPct: 80,
  },
];

/* --------------------------------- indices -------------------------------- */
const INDICES: Draft[] = [
  {
    symbol: 'US500',
    base: 'US500',
    quote: 'USD',
    name: 'S&P 500',
    basePrice: 5234.5,
    volatility: 0.0005,
    precision: 2,
    payoutPct: 84,
    otc: true,
    icon: 'SPX',
  },
  {
    symbol: 'US100',
    base: 'US100',
    quote: 'USD',
    name: 'Nasdaq 100',
    basePrice: 18342.8,
    volatility: 0.0007,
    precision: 2,
    payoutPct: 84,
    otc: true,
    icon: 'NDX',
  },
  {
    symbol: 'US30',
    base: 'US30',
    quote: 'USD',
    name: 'Dow Jones 30',
    basePrice: 39187.2,
    volatility: 0.0004,
    precision: 2,
    payoutPct: 83,
    icon: 'DJI',
  },
  {
    symbol: 'DE40',
    base: 'DE40',
    quote: 'EUR',
    name: 'DAX 40',
    basePrice: 18124.6,
    volatility: 0.0005,
    precision: 2,
    payoutPct: 83,
    icon: 'DAX',
  },
  {
    symbol: 'UK100',
    base: 'UK100',
    quote: 'GBP',
    name: 'FTSE 100',
    basePrice: 7952.4,
    volatility: 0.0004,
    precision: 2,
    payoutPct: 82,
    icon: 'FTSE',
  },
];

/** OTC markets are broker-priced, never closed, and carry a small payout premium. */
const OTC_PAYOUT_BONUS = 3;
const OTC_VOLATILITY_FACTOR = 1.15;

function build(drafts: Draft[], assetClass: AssetClass, feed: (draft: Draft) => string): MarketSpec[] {
  const out: MarketSpec[] = [];

  for (const draft of drafts) {
    const symbol = draft.symbol ?? `${draft.base}${draft.quote}`;
    const spec: MarketSpec = {
      symbol,
      name: draft.name,
      pair: assetClass === 'STOCK' || assetClass === 'INDEX' ? draft.name : `${draft.base}/${draft.quote}`,
      assetClass,
      base: draft.base,
      quote: draft.quote,
      feedSymbol: draft.feedSymbol ?? feed(draft),
      isOtc: false,
      payoutPct: draft.payoutPct,
      precision: draft.precision,
      pipSize: pipFor(draft.precision),
      basePrice: draft.basePrice,
      volatility: draft.volatility,
      icon: draft.icon ?? draft.base,
    };
    out.push(spec);

    if (draft.otc) {
      out.push({
        ...spec,
        symbol: `${symbol}_OTC`,
        name: `${draft.name} (OTC)`,
        pair: `${spec.pair} (OTC)`,
        isOtc: true,
        // broker-priced, so there is no exchange symbol to follow
        feedSymbol: `${symbol}_OTC`,
        payoutPct: Math.min(draft.payoutPct + OTC_PAYOUT_BONUS, 95),
        volatility: Number((draft.volatility * OTC_VOLATILITY_FACTOR).toFixed(6)),
      });
    }
  }

  return out;
}

export const MARKETS: MarketSpec[] = [
  ...build(CURRENCIES, 'CURRENCY', (draft) => `${draft.base}${draft.quote}`),
  ...build(CRYPTO, 'CRYPTO', (draft) => `${draft.base}${draft.quote}`),
  ...build(COMMODITIES, 'COMMODITY', (draft) => draft.symbol ?? `${draft.base}${draft.quote}`),
  ...build(STOCKS, 'STOCK', (draft) => draft.symbol ?? draft.base),
  ...build(INDICES, 'INDEX', (draft) => draft.symbol ?? draft.base),
].map((spec, index) => ({ ...spec, sortOrder: index }) as MarketSpec & { sortOrder: number });

export const MARKET_COUNTS = {
  total: MARKETS.length,
  byClass: MARKETS.reduce<Record<string, number>>((acc, market) => {
    acc[market.assetClass] = (acc[market.assetClass] ?? 0) + 1;
    return acc;
  }, {}),
  otc: MARKETS.filter((market) => market.isOtc).length,
};
