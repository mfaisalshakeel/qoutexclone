import { expect, test } from '@playwright/test';
import { ADMIN, TRADER, failOnPageErrors, login, placeTrade } from './helpers';

test.describe('risk limits', () => {
  test('the back office shows the book and caps what one trader can hold', async ({ browser }) => {
    const adminContext = await browser.newContext();
    const traderContext = await browser.newContext();
    const admin = await adminContext.newPage();
    const trader = await traderContext.newPage();
    const adminErrors = failOnPageErrors(admin);
    // hitting the limit is the point, so its 409 is not a fault
    const traderErrors = failOnPageErrors(trader, [/status of 409/]);

    try {
      await login(admin, ADMIN);
      await admin.goto('/admin/risk');
      await expect(admin.getByRole('heading', { name: 'Risk' })).toBeVisible();
      // the book is live-money only, which the page says out loud
      await expect(admin.getByText(/Live-money exposure only/)).toBeVisible();
      await expect(admin.getByText('Open on UP')).toBeVisible();
      await expect(admin.getByText('Worst-case payout')).toBeVisible();

      // every market, so a limit can be set before anyone has traded it
      await admin.getByLabel('Only markets with open positions').uncheck();
      const row = admin.getByRole('row', { name: /EUR\/USD/ }).first();
      await expect(row).toBeVisible();

      // a per-trader cap of $15 on this market
      await row.getByRole('button', { name: 'Limits' }).click();
      await row.getByLabel(/per-trader limit in cents/).fill('1500');
      await row.getByRole('button', { name: 'Save' }).click();
      await expect(row.getByText('$15')).toBeVisible();

      // a practice trader is never held back by the house's book, but their own
      // per-market cap still applies
      await login(trader, TRADER);
      // the workspace is saved on the account now, so the terminal opens on
      // whatever market was last used — this spec caps EUR/USD, so it has to
      // put the trader there rather than assume it
      await trader.waitForSelector('canvas');
      const rail = trader.getByRole('complementary').filter({ has: trader.getByLabel('Search markets') });
      await rail.getByLabel('Search markets').fill('EURUSD');
      await rail.getByRole('button', { name: 'EUR/USD', exact: true }).first().click();
      await rail.getByLabel('Search markets').fill('');

      await placeTrade(trader, 'Higher', '1m');
      await placeTrade(trader, 'Higher', '1m');

      // $10 + $10 is past the $15 cap, so the second is refused with a reason
      // that stays on the ticket
      const ticket = trader.getByRole('region', { name: 'Order ticket' });
      await expect(ticket.getByText(/open on this market/)).toBeVisible({ timeout: 15_000 });

      expect(adminErrors).toEqual([]);
      expect(traderErrors).toEqual([]);
    } finally {
      // leave the market as it was, whatever happened above
      const cleanup = await browser.newContext();
      const page = await cleanup.newPage();
      await login(page, ADMIN);
      await page.goto('/admin/risk');
      await page.getByLabel('Only markets with open positions').uncheck();
      const row = page.getByRole('row', { name: /EUR\/USD/ }).first();
      await row.getByRole('button', { name: 'Limits' }).click();
      await row.getByLabel(/per-trader limit in cents/).fill('0');
      await row.getByRole('button', { name: 'Save' }).click();
      await cleanup.close();
      await adminContext.close();
      await traderContext.close();
    }
  });

  test('refuses limits that contradict each other', async ({ page }) => {
    const errors = failOnPageErrors(page, [/status of 400/]);
    await login(page, ADMIN);
    await page.goto('/admin/risk');
    await page.getByLabel('Only markets with open positions').uncheck();

    const row = page.getByRole('row', { name: /EUR\/USD/ }).first();
    await row.getByRole('button', { name: 'Limits' }).click();
    // a side limit is a whole number of cents and cannot be negative
    await row.getByLabel(/side limit in cents/).fill('-100');
    await row.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText(/Could not save|Invalid/i).first()).toBeVisible();

    expect(errors).toEqual([]);
  });
});
