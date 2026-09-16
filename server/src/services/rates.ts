import { marketFeed } from '../engine/feed.js';

/** USD price for one unit of `currency`, taken from the live market feed. */
export function usdRate(currency: string): number {
  switch (currency.toUpperCase()) {
    case 'USDT':
    case 'USDC':
    case 'USD':
      return 1;
    case 'BTC':
      return marketFeed.getPrice('BTCUSD') ?? 60000;
    case 'ETH':
      return marketFeed.getPrice('ETHUSD') ?? 3000;
    default: {
      const price = marketFeed.getPrice(`${currency.toUpperCase()}USD`);
      if (price == null) throw new Error(`no rate for ${currency}`);
      return price;
    }
  }
}
