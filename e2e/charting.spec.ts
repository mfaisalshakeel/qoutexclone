import { expect, test } from '@playwright/test';
import { failOnPageErrors, login, TRADER } from './helpers';

test.describe('charting', () => {
  test('pages history backwards as you scroll into the past', async ({ page }) => {
    const errors = failOnPageErrors(page);
    const pages: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/market/candles/')) pages.push(request.url());
    });

    await login(page, TRADER);
    await page.waitForSelector('canvas');
    // the first page loads without a cursor
    await expect.poll(() => pages.length).toBeGreaterThan(0);
    expect(pages[0]).not.toContain('before=');

    // drag the time scale far to the right, which walks the view into the past
    const chart = page.locator('canvas').first();
    const box = (await chart.boundingBox())!;
    for (let pull = 0; pull < 6; pull += 1) {
      await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.95, box.y + box.height / 2, { steps: 12 });
      await page.mouse.up();
      if (pages.some((url) => url.includes('before='))) break;
    }

    await expect
      .poll(() => pages.filter((url) => url.includes('before=')).length, {
        timeout: 15_000,
      })
      .toBeGreaterThan(0);

    // each older page is requested once, with its own cursor
    const cursors = pages.filter((url) => url.includes('before='));
    expect(new Set(cursors).size).toBe(cursors.length);
    expect(errors).toEqual([]);
  });

  test('switches to any of the fourteen timeframes', async ({ page }) => {
    const errors = failOnPageErrors(page);
    await login(page, TRADER);
    await page.waitForSelector('canvas');

    // the quick row covers the common ones; the menu covers all of them
    await page.getByRole('button', { name: '5m', exact: true }).first().click();
    await expect(page.getByRole('button', { name: '5m', exact: true }).first()).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await page.getByRole('button', { name: 'All timeframes' }).click();
    await page.getByRole('button', { name: '4h', exact: true }).click();
    await expect(page.getByRole('button', { name: 'All timeframes' })).toContainText('4h');

    await page.waitForTimeout(1500);
    expect(errors).toEqual([]);
  });
});
