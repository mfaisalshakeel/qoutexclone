/**
 * Chart performance harness.
 *
 * Loads five thousand candles into the renderer, throttles the CPU to a
 * mid-range phone, then pans and zooms while counting frames. It reports the
 * median and worst frame times, which is what "60fps" actually means: not an
 * average anyone can hit between stalls, but a frame budget of 16.7ms that is
 * rarely missed.
 *
 *   node scripts/chart-perf.mjs            # against the running dev server
 *   PERF_THROTTLE=1 node scripts/chart-perf.mjs   # no CPU throttling
 */
import { chromium, devices } from '@playwright/test';

const BASE = process.env.PERF_BASE_URL ?? 'http://localhost:5173';
const THROTTLE = Number(process.env.PERF_THROTTLE ?? 4);
const CANDLES = Number(process.env.PERF_CANDLES ?? 5000);
const EMAIL = process.env.PERF_EMAIL ?? 'trader@quotexclone.dev';
const PASSWORD = process.env.PERF_PASSWORD ?? 'Trader123!';

const PROFILE = process.env.PERF_PROFILE ?? 'desktop';

const browser = await chromium.launch({
  executablePath: process.env.E2E_CHROMIUM_PATH || undefined,
});
// the phone profile is a Pixel 7: a third of the width and three times the
// pixels, which is the load a mid-range phone's GPU actually carries
const page = await browser.newPage(
  PROFILE === 'phone' ? { ...devices['Pixel 7'] } : { viewport: { width: 1280, height: 800 } },
);

/*
 * This measures the renderer, not the network. Panning into the past normally
 * fetches another page of history, which would put a round trip and a reload of
 * every study inside the measurement and tell us nothing about frame times, so
 * the history endpoint answers "no more" for the duration.
 */
await page.route('**/api/market/candles/**', (route) =>
  route.fulfill({ json: { candles: [], nextBefore: null } }),
);

await page.goto(`${BASE}/login`);
await page.fill('#email', EMAIL);
await page.fill('#password', PASSWORD);
await page.click('button[type=submit]');
await page.waitForURL('**/trade');
await page.waitForSelector('canvas');
await page.waitForTimeout(2500);

// five thousand bars of a plausible random walk, straight into the renderer
await page.evaluate((count) => {
  const chart = window.__chart;
  if (!chart) throw new Error('the chart did not expose itself; is this a dev build?');
  const candles = [];
  let price = 1.085;
  const start = Math.floor(Date.now() / 1000) - count * 60;
  for (let index = 0; index < count; index += 1) {
    const open = price;
    const drift = (Math.sin(index / 180) + Math.sin(index / 37)) * 0.00004;
    price = open + drift + (Math.random() - 0.5) * 0.0004;
    const high = Math.max(open, price) + Math.random() * 0.0002;
    const low = Math.min(open, price) - Math.random() * 0.0002;
    candles.push({ time: start + index * 60, open, high, low, close: price });
  }
  chart.setCandles(candles);
}, CANDLES);

const cdp = await page.context().newCDPSession(page);
if (THROTTLE > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });

/** Collects the gap between painted frames while the chart is driven. */
await page.evaluate(() => {
  window.__frames = [];
  window.__paints = [];
  let previous = performance.now();
  const tick = (now) => {
    window.__frames.push(now - previous);
    previous = now;
    window.__raf = requestAnimationFrame(tick);
  };
  window.__raf = requestAnimationFrame(tick);
});

const box = await page.locator('canvas').first().boundingBox();
const middle = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

// pan: six long drags across the plot
await page.mouse.move(middle.x, middle.y);
for (let pass = 0; pass < 6; pass += 1) {
  await page.mouse.move(box.x + box.width * 0.8, middle.y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.2, middle.y, { steps: 40 });
  await page.mouse.up();
}

// zoom: in and out through the whole range
for (let pass = 0; pass < 24; pass += 1) {
  await page.mouse.wheel(0, pass % 2 === 0 ? -240 : 240);
  await page.waitForTimeout(16);
}

const stats = await page.evaluate((candles) => {
  cancelAnimationFrame(window.__raf);
  const percentiles = (values) => {
    const sorted = values.slice().sort((a, b) => a - b);
    const at = (share) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))] ?? 0;
    return { count: sorted.length, median: at(0.5), p95: at(0.95), worst: sorted.at(-1) ?? 0 };
  };
  const frames = window.__frames.filter((each) => each > 0 && each < 1000);
  return {
    candles,
    frame: percentiles(frames),
    paint: percentiles(window.__paints ?? []),
    // vsync pins a healthy frame at 16.7ms, so anything past a frame and a
    // half is a stall a trader would see rather than rounding noise
    dropped: frames.filter((each) => each > 25).length,
  };
}, CANDLES);

const pct = (n) => `${((n / stats.frame.count) * 100).toFixed(1)}%`;
console.log(
  [
    `profile          ${PROFILE}`,
    `candles          ${stats.candles}`,
    `cpu throttle     ${THROTTLE}x`,
    `frames           ${stats.frame.count}`,
    `median frame     ${stats.frame.median.toFixed(1)}ms  (${(1000 / stats.frame.median).toFixed(0)}fps)`,
    `95th frame       ${stats.frame.p95.toFixed(1)}ms`,
    `worst frame      ${stats.frame.worst.toFixed(1)}ms`,
    `dropped (>25ms)  ${stats.dropped} (${pct(stats.dropped)})`,
    '',
    `paints           ${stats.paint.count}`,
    `median paint     ${stats.paint.median.toFixed(2)}ms`,
    `95th paint       ${stats.paint.p95.toFixed(2)}ms`,
    `worst paint      ${stats.paint.worst.toFixed(2)}ms`,
  ].join('\n'),
);

await browser.close();
