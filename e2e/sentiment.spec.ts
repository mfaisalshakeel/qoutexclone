import { expect, test } from '@playwright/test';
import { TRADER, failOnPageErrors, login, openMarket } from './helpers';

test.describe('trader sentiment', () => {
  test('appears once enough positions exist, and reflects staked money', async ({ page }) => {
    const errors = failOnPageErrors(page);
    await login(page, TRADER);
    // an always-open market, so these specs do not depend on the clock or on
    // whichever market another spec left on the account
    await openMarket(page, 'EURUSD_OTC', 'EUR/USD (OTC)');

    const ticket = page.getByRole('region', { name: 'Order ticket' });

    // a fresh market has nothing to say, and says that rather than drawing a bar
    const quiet = ticket.getByText(/No recent positions|Not enough activity/);
    const hadQuiet = (await quiet.count()) > 0;

    // take enough positions on one side to pass the threshold
    await ticket
      .getByRole('group', { name: 'Expiry' })
      .getByRole('button', { name: '1m', exact: true })
      .click();
    await ticket
      .getByRole('group', { name: 'Investment' })
      .getByRole('button', { name: '10', exact: true })
      .click();
    for (let index = 0; index < 5; index += 1) {
      await ticket.getByRole('button', { name: /Higher/ }).click();
      await page.waitForTimeout(400);
    }

    // sentiment is pushed on its own slow loop, so it arrives without a reload
    const bar = ticket.getByRole('img', { name: /of staked money is on higher/ });
    await expect(bar).toBeVisible({ timeout: 25_000 });
    await expect(ticket.getByText(/% higher$/)).toBeVisible();
    await expect(ticket.getByText(/% lower$/)).toBeVisible();

    // the two shares always add to 100 — a 49/50 bar would undermine the rest
    const label = (await bar.getAttribute('aria-label'))!;
    const [, up, down] = label.match(/(\d+)% of staked money is on higher, (\d+)%/)!;
    expect(Number(up) + Number(down)).toBe(100);
    // five UP positions and nothing against them
    expect(Number(up)).toBeGreaterThan(Number(down));

    if (hadQuiet) await expect(quiet).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});
