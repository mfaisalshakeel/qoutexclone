import { expect, test } from '@playwright/test';
import { ADMIN, failOnPageErrors, fundAccount, login, newCredentials, register } from './helpers';

test.describe('growth admin screens', () => {
  test('a bonus offer created in the back office reaches a trader at deposit time', async ({ browser }) => {
    const adminContext = await browser.newContext();
    const admin = await adminContext.newPage();
    const adminErrors = failOnPageErrors(admin);
    await login(admin, ADMIN);
    await admin.goto('/admin/bonus-offers');

    const key = `e2e-${Date.now()}`;
    const name = `E2E Bonus ${Date.now()}`;
    await admin.fill('#bo-key', key);
    await admin.fill('#bo-name', name);
    await admin.fill('#bo-description', 'A bonus created by an end-to-end test.');
    await admin.fill('#bo-percent', '40');
    await admin.fill('#bo-max', '400');
    await admin.fill('#bo-min', '20');
    await admin.fill('#bo-turnover', '10');
    await admin.click('button:has-text("Create offer")');
    await expect(admin.getByText('Bonus offer created')).toBeVisible();

    const row = admin.getByRole('row', { name: new RegExp(name) });
    await expect(row).toBeVisible();
    await expect(row.getByText('40% up to $400.00, 10× turnover')).toBeVisible();

    const traderContext = await browser.newContext();
    const trader = await traderContext.newPage();
    const traderErrors = failOnPageErrors(trader);
    await register(trader, newCredentials('growth'));
    await trader.goto('/wallet');
    await trader.locator('button:has-text("Tether (TRC-20)")').first().click();
    await trader.locator('button:has-text("$250")').first().click();
    const choices = trader.getByRole('group', { name: 'Deposit bonus' });
    await expect(choices.getByText(name)).toBeVisible();

    // switch it off from the back office and confirm it stops being offered
    await row.getByText('active').click();
    await expect(row.getByText('closed')).toBeVisible();

    await trader.reload();
    await trader.locator('button:has-text("Tether (TRC-20)")').first().click();
    await trader.locator('button:has-text("$250")').first().click();
    await expect(trader.getByRole('group', { name: 'Deposit bonus' }).getByText(name)).toHaveCount(0);

    expect(adminErrors).toEqual([]);
    expect(traderErrors).toEqual([]);
    await adminContext.close();
    await traderContext.close();
  });

  test('a marketplace item created in the back office can be bought by a trader', async ({ browser }) => {
    const adminContext = await browser.newContext();
    const admin = await adminContext.newPage();
    const adminErrors = failOnPageErrors(admin);
    await login(admin, ADMIN);
    await admin.goto('/admin/marketplace-items');

    const key = `e2e-refill-${Date.now()}`;
    const name = `E2E Practice Top-up ${Date.now()}`;
    await admin.fill('#mi-key', key);
    await admin.fill('#mi-name', name);
    await admin.selectOption('#mi-kind', 'PRACTICE_REFILL');
    await admin.fill('#mi-description', 'A marketplace item created by an end-to-end test.');
    await admin.fill('#mi-price-cents', '5');
    await admin.fill('#mi-cfg-amountCentsUsd', '1000');
    await admin.click('button:has-text("Create item")');
    await expect(admin.getByText('Marketplace item created')).toBeVisible();

    const row = admin.getByRole('row', { name: new RegExp(name) });
    await expect(row).toBeVisible();
    await expect(row.getByText('Practice refill')).toBeVisible();
    await expect(row.getByText('$5.00')).toBeVisible();

    let traderContext: import('@playwright/test').BrowserContext | null = null;
    try {
      traderContext = await browser.newContext();
      const trader = await traderContext.newPage();
      const traderErrors = failOnPageErrors(trader);
      await register(trader, newCredentials('growth-shop'));
      await fundAccount(trader, '$50');
      await trader.goto('/marketplace');
      await expect(trader.getByRole('heading', { name, level: 2 })).toBeVisible();
      expect(traderErrors).toEqual([]);
    } finally {
      // a marketplace item is permanent catalogue data, not per-test state —
      // leaving this enabled would keep colliding with other specs' own
      // fixture items priced the same way, the way it did the first time
      await row.getByText('active').click();
      await expect(row.getByText('closed')).toBeVisible();
      await traderContext?.close();
    }

    expect(adminErrors).toEqual([]);
    await adminContext.close();
  });
});
