import { expect, test, type Page } from '@playwright/test';
import { TRADER, expectNoHorizontalScroll, failOnPageErrors, login } from './helpers';

/**
 * Drives a real touchscreen through Chromium, because the terminal's gestures
 * listen for touch events — a mouse drag would prove nothing.
 */
async function swipe(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  const cdp = await page.context().newCDPSession(page);
  const touch = (x: number, y: number) => [{ x, y, radiusX: 8, radiusY: 8, force: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: touch(from.x, from.y) });
  const steps = 5;
  for (let step = 1; step <= steps; step += 1) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: touch(
        from.x + ((to.x - from.x) * step) / steps,
        from.y + ((to.y - from.y) * step) / steps,
      ),
    });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

test.describe('the terminal on a phone', () => {
  test('docks the trade, fills the screen with the chart, and never scrolls the page', async ({ page }) => {
    const errors = failOnPageErrors(page);
    await login(page, TRADER);
    await page.waitForSelector('canvas');

    // the chart goes edge to edge — measured across every canvas it draws on,
    // because the price scale is one of its own
    const viewport = page.viewportSize()!;
    const span = await page.evaluate(() => {
      const boxes = [...document.querySelectorAll('canvas')].map((each) => each.getBoundingClientRect());
      return { left: Math.min(...boxes.map((b) => b.left)), right: Math.max(...boxes.map((b) => b.right)) };
    });
    expect(span.left).toBeLessThanOrEqual(1);
    expect(span.right).toBeGreaterThanOrEqual(viewport.width - 1);

    // and the page itself does not scroll: the terminal is the screen
    const scrollable = await page.evaluate(
      () => document.documentElement.scrollHeight - document.documentElement.clientHeight,
    );
    expect(scrollable).toBeLessThanOrEqual(1);
    await expectNoHorizontalScroll(page);

    // the dock carries the trade
    const dock = page.getByRole('button', { name: /^Amount/ });
    await expect(dock).toBeVisible();
    await expect(page.getByRole('button', { name: /^Expiry/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Higher/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Lower/ })).toBeVisible();

    // the ticket is a sheet away, and what it changes shows on the dock
    await dock.tap();
    const ticket = page.getByRole('dialog', { name: 'Order ticket' });
    await expect(ticket).toBeVisible();
    await ticket.getByRole('button', { name: '25', exact: true }).tap();
    await ticket.getByRole('button', { name: 'Done' }).tap();
    await expect(ticket).toBeHidden();
    await expect(dock).toContainText('$25.00');

    // a trade goes straight from the dock, without opening anything
    await page.getByRole('button', { name: /^Higher/ }).tap();
    await expect(page.getByRole('button', { name: /^Positions/ })).toContainText('1 open', {
      timeout: 20_000,
    });

    expect(errors).toEqual([]);
  });

  test('pinches the chart to zoom and carries a flick after the finger lifts', async ({ page }) => {
    const errors = failOnPageErrors(page);
    await login(page, TRADER);
    await page.waitForSelector('canvas');

    const box = (await page.locator('canvas').first().boundingBox())!;
    const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const cdp = await page.context().newCDPSession(page);
    const finger = (x: number, y: number) => ({ x, y, radiusX: 8, radiusY: 8, force: 1 });
    const live = page.getByRole('button', { name: /Scroll to live/ });
    // two fingers spreading zoom in about the point between them, so pinching
    // the middle of the chart pulls the live edge off the right of the screen
    await expect(live).toBeHidden();
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [finger(centre.x - 60, centre.y), finger(centre.x + 60, centre.y)],
    });
    for (let step = 1; step <= 6; step += 1) {
      const gap = 60 + step * 20;
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [finger(centre.x - gap, centre.y), finger(centre.x + gap, centre.y)],
      });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(live).toBeVisible();
    await live.tap();
    await expect(live).toBeHidden();

    // and a flick throws the chart into the past, carrying on after the finger
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [finger(centre.x - 120, centre.y)],
    });
    for (let step = 1; step <= 5; step += 1) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [finger(centre.x - 120 + step * 40, centre.y)],
      });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
    await expect(live).toBeVisible();

    // the first tap stops the coast — a browser swallows the click that would
    // have followed a touch made while a gesture is still in flight, which is
    // also how a native list behaves — so the second one is the one that acts
    await live.tap();
    await live.tap();
    await expect(live).toBeHidden();

    expect(errors).toEqual([]);
  });

  test('opens the positions sheet, swipes between its tabs and pulls it closed', async ({ page }) => {
    const errors = failOnPageErrors(page);
    await login(page, TRADER);
    await page.waitForSelector('canvas');

    await page.getByRole('button', { name: /^Positions/ }).tap();
    const sheet = page.getByRole('dialog', { name: 'Positions' });
    await expect(sheet).toBeVisible();

    const open = sheet.getByRole('tab', { name: /Open/ });
    await expect(open).toHaveAttribute('aria-selected', 'true');

    // swiping the list left moves to the next tab, as a native app does
    const list = sheet.getByRole('tabpanel');
    const box = (await list.boundingBox())!;
    const y = box.y + box.height / 2;
    await swipe(page, { x: box.x + box.width - 30, y }, { x: box.x + 30, y });
    await expect(sheet.getByRole('tab', { name: /Pending/ })).toHaveAttribute('aria-selected', 'true');

    await swipe(page, { x: box.x + box.width - 30, y }, { x: box.x + 30, y });
    await expect(sheet.getByRole('tab', { name: 'Closed' })).toHaveAttribute('aria-selected', 'true');

    // and it stops at the end rather than wrapping round to the start
    await swipe(page, { x: box.x + box.width - 30, y }, { x: box.x + 30, y });
    await expect(sheet.getByRole('tab', { name: 'Closed' })).toHaveAttribute('aria-selected', 'true');

    // pulling the sheet down by its handle dismisses it
    const panel = (await sheet.boundingBox())!;
    await swipe(
      page,
      { x: panel.x + panel.width / 2, y: panel.y + 12 },
      { x: panel.x + panel.width / 2, y: panel.y + panel.height },
    );
    await expect(sheet).toBeHidden();

    expect(errors).toEqual([]);
  });
});
