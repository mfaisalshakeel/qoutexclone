import { expect, test, type Locator, type Page } from '@playwright/test';
import { newCredentials, openMarket, register } from './helpers';

/**
 * Screenshot tests for the chart engine.
 *
 * Pixels can only be compared against a baseline when nothing underneath them
 * moves, so the whole chart is pinned: the clock is fixed, history is served
 * from a seeded generator rather than the feed, and the socket's candle pushes
 * are dropped on the way in (quotes still flow, so the rest of the terminal
 * behaves normally). What is left changing is the renderer itself, which is
 * exactly what these tests are for.
 */

/** The instant the whole suite pretends it is. Fixes the time axis too. */
const NOW = Date.UTC(2026, 0, 15, 12, 0, 0);
const MINUTE = 60_000;
const BARS = 300;

interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

/** A small deterministic PRNG: the same baseline on every machine and run. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A minute series with a trend, a pullback and a range in it, so the
 * indicators have something to say and the bars are not all one colour.
 */
function history(): Candle[] {
  const next = random(20260920);
  const candles: Candle[] = [];
  let price = 1.085;
  for (let index = 0; index < BARS; index += 1) {
    // three regimes across the window: up, down, sideways
    const drift = index < BARS * 0.45 ? 0.000045 : index < BARS * 0.75 ? -0.00006 : 0;
    const open = price;
    const close = open + drift + (next() - 0.5) * 0.0006;
    const high = Math.max(open, close) + next() * 0.00035;
    const low = Math.min(open, close) - next() * 0.00035;
    candles.push({
      time: Math.floor((NOW - (BARS - 1 - index) * MINUTE) / 1000),
      open: Number(open.toFixed(5)),
      high: Number(high.toFixed(5)),
      low: Number(low.toFixed(5)),
      close: Number(close.toFixed(5)),
    });
    price = close;
  }
  return candles;
}

const CANDLES = history();
const LAST = CANDLES[CANDLES.length - 1];

const SERIES: { kind: string; label: string }[] = [
  { kind: 'candles', label: 'Candlesticks' },
  { kind: 'bars', label: 'Bars' },
  { kind: 'heikin-ashi', label: 'Heikin-Ashi' },
  { kind: 'line', label: 'Line' },
  { kind: 'area', label: 'Area' },
];

/** Every study in the registry, so a new indicator cannot ship unrendered. */
const STUDY_IDS = [
  'sma',
  'ema',
  'wma',
  'bollinger',
  'donchian',
  'keltner',
  'ichimoku',
  'alligator',
  'psar',
  'supertrend',
  'zigzag',
  'fractals',
  'rsi',
  'macd',
  'stochastic',
  'atr',
  'adx',
  'cci',
  'williams',
  'momentum',
  'ao',
];

/**
 * A little slack on every comparison.
 *
 * Text rasterisation differs by a subpixel between runs of the same machine,
 * and the live-price dot breathes on a timer that no test should have to stop.
 */
const SHOT = { maxDiffPixelRatio: 0.02, threshold: 0.25 } as const;

async function pin(page: Page): Promise<void> {
  await page.clock.setFixedTime(NOW);

  // history comes from the generator, not the feed
  await page.route('**/api/market/candles/**', (route) =>
    route.fulfill({ json: { candles: CANDLES, nextBefore: null } }),
  );

  // the socket stays connected — only the candle pushes are dropped, so the
  // chart holds still while the rest of the terminal keeps its prices
  await page.routeWebSocket(/\/ws/, (ws) => {
    const server = ws.connectToServer();
    server.onMessage((message) => {
      const text = typeof message === 'string' ? message : message.toString();
      if (/"type":"candles?"/.test(text)) return;
      ws.send(message);
    });
    ws.onMessage((message) => server.send(message));
  });
}

/** The chart, once it holds the pinned history and has painted it. */
async function chartOf(page: Page): Promise<Locator> {
  const chart = page.getByTestId('chart');
  await expect(chart).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __chart?: { candleCount: number } }).__chart?.candleCount))
    .toBe(BARS);
  return chart;
}

/** Puts a set of studies on the account, the way the settings panel does. */
async function setStudies(page: Page, ids: string[]): Promise<void> {
  const status = await page.evaluate(async (studies) => {
    const response = await fetch('/api/me/studies', {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${localStorage.getItem('qx.access')}`,
      },
      body: JSON.stringify({ studies: studies.map((id) => ({ id })) }),
    });
    return response.status;
  }, ids);
  expect(status).toBe(200);
}

test.describe('chart visuals', () => {
  // a fixed timezone, or the time axis reads differently on another machine
  test.use({ timezoneId: 'UTC', locale: 'en-GB' });

  // a brand new account every time: the shared trader carries whatever the
  // specs before it left behind — open positions draw strike lines, and a
  // strike line far from the last price stretches the whole price scale
  test.beforeEach(async ({ page }) => {
    await pin(page);
    await register(page, newCredentials('visual'));
    await openMarket(page, 'EURUSD_OTC', 'EUR/USD (OTC)');
  });

  test('draws every series type', async ({ page }) => {
    const chart = await chartOf(page);
    const group = page.getByRole('group', { name: 'Series type' });

    for (const { kind, label } of SERIES) {
      await group.getByRole('button', { name: label }).click();
      await expect(group.getByRole('button', { name: label })).toHaveAttribute('aria-pressed', 'true');
      await expect(chart).toHaveScreenshot(`series-${kind}.png`, SHOT);
    }
  });

  test('draws the overlays a position puts on the chart', async ({ page }) => {
    const chart = await chartOf(page);

    // two positions rather than one: opposite directions, one winning and one
    // losing, and close enough in price to exercise the label stacking
    await page.evaluate(
      ({ now, price }) => {
        const engine = (window as unknown as { __chart?: { setTrades(trades: unknown[]): void } }).__chart;
        const trade = (id: string, direction: 'UP' | 'DOWN', entry: number, seconds: number) => ({
          id,
          symbol: 'EURUSD_OTC',
          direction,
          stake: 2500,
          payoutRate: 0.87,
          entryPrice: entry,
          status: 'OPEN',
          expiryMode: 'TIMER',
          openedAt: new Date(now - 30_000).toISOString(),
          expiresAt: new Date(now + seconds * 1000).toISOString(),
          accountType: 'PRACTICE',
        });
        engine?.setTrades([
          trade('visual-up', 'UP', entryBelow(price), 120),
          trade('visual-down', 'DOWN', entryAbove(price), 240),
        ]);

        function entryBelow(value: number) {
          return Number((value - 0.0004).toFixed(5));
        }
        function entryAbove(value: number) {
          return Number((value + 0.0004).toFixed(5));
        }
      },
      { now: NOW, price: LAST.close },
    );

    await expect(chart).toHaveScreenshot('overlays-open-positions.png', SHOT);
  });

  test('draws every indicator in the registry', async ({ page }) => {
    await chartOf(page);

    for (const id of STUDY_IDS) {
      await setStudies(page, [id]);
      await page.reload();
      await openMarket(page, 'EURUSD_OTC', 'EUR/USD (OTC)');
      const chart = await chartOf(page);
      await expect(chart).toHaveScreenshot(`study-${id}.png`, SHOT);
    }

    // and a stack of them, which is where the panes have to share the height
    await setStudies(page, ['bollinger', 'rsi', 'macd']);
    await page.reload();
    await openMarket(page, 'EURUSD_OTC', 'EUR/USD (OTC)');
    await expect(await chartOf(page)).toHaveScreenshot('study-stacked-panes.png', SHOT);

    await setStudies(page, []);
  });
});
