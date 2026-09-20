import { expect, test } from '@playwright/test';
import {
  failOnPageErrors,
  newCredentials,
  openMarket,
  placeTrade,
  register,
  useLiveAccount,
} from './helpers';

/**
 * Deposit bonuses and the turnover behind them.
 *
 * The thing worth testing is the promise, not the arithmetic: that a trader is
 * told what a bonus costs them in turnover *before* they take it, and that the
 * money cannot leave until they have done it.
 */
test.describe('deposit bonuses', () => {
  test('offers a choice at checkout and says what the turnover is', async ({ page }) => {
    const errors = failOnPageErrors(page);
    await register(page, newCredentials('bonus'));

    await page.goto('/wallet');
    await page.locator('button:has-text("Tether (TRC-20)")').first().click();
    await page.locator('button:has-text("$250")').first().click();

    const choices = page.getByRole('group', { name: 'Deposit bonus' });
    await expect(choices.getByText('No bonus')).toBeVisible();
    await expect(choices.getByText('30% welcome bonus')).toBeVisible();
    // the price of the bonus is on the option, not in terms somewhere else
    await expect(choices.getByText(/stake \$1,125\.00 to release it/)).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('locks the bonus until it is staked, and says so on the withdraw screen', async ({ page }) => {
    await register(page, newCredentials('bonus-lock'));

    await page.goto('/wallet');
    await page.locator('button:has-text("Tether (TRC-20)")').first().click();
    await page.locator('button:has-text("$100")').first().click();
    await page.getByRole('group', { name: 'Deposit bonus' }).getByText('10% with light turnover').click();
    await page.click('button:has-text("Get deposit address")');
    await expect(page.getByText('Awaiting deposit')).toBeVisible();
    await page.click('text=Simulate the incoming payment');
    await expect(page.getByText('Deposit credited')).toBeVisible({ timeout: 120_000 });

    // $100 deposited plus a $10 bonus, which needs $50 staked
    await page.goto('/wallet?tab=withdraw');
    await expect(page.getByText('Bonus still to release')).toBeVisible();
    await expect(page.getByRole('progressbar', { name: 'Bonus turnover progress' })).toHaveAttribute(
      'aria-valuenow',
      '0',
    );
    await expect(page.getByText('stake $50.00 more')).toBeVisible();

    // and the locked part cannot leave
    await page.locator('button:has-text("Tether (TRC-20)")').first().click();
    await page.fill('#withdraw-address', 'TJRyWwFs9wTFGZg3JbrVriFbNfCug5tDeC');
    await page.fill('#withdraw-amount', '105');
    await page.click('button:has-text("Request withdrawal")');
    await expect(page.getByText(/bonus is still locked/)).toBeVisible();
  });

  test('a live position moves the turnover bar', async ({ page }) => {
    await register(page, newCredentials('bonus-turn'));

    await page.goto('/wallet');
    await page.locator('button:has-text("Tether (TRC-20)")').first().click();
    await page.locator('button:has-text("$100")').first().click();
    await page.getByRole('group', { name: 'Deposit bonus' }).getByText('10% with light turnover').click();
    await page.click('button:has-text("Get deposit address")');
    await page.click('text=Simulate the incoming payment');
    await expect(page.getByText('Deposit credited')).toBeVisible({ timeout: 120_000 });

    await page.goto('/trade');
    await openMarket(page, 'EURUSD_OTC', 'EUR/USD (OTC)');
    await useLiveAccount(page);
    await placeTrade(page, 'Higher', '30s');
    // wait for it to appear before waiting for it to go: a fresh account reads
    // "Open (0)" until the position lands, which would pass this instantly
    await expect(page.getByText('Open (1)')).toBeVisible();
    await expect(page.getByText('Open (0)')).toBeVisible({ timeout: 90_000 });

    // turnover is credited from the settlement event, just after the position
    // closes, so the page is re-read rather than read once
    await expect
      .poll(
        async () => {
          await page.goto('/wallet?tab=withdraw');
          return page
            .getByRole('progressbar', { name: 'Bonus turnover progress' })
            .getAttribute('aria-valuenow');
        },
        { timeout: 30_000 },
      )
      // $10 staked of the $50 needed
      .toBe('20');
  });
});
