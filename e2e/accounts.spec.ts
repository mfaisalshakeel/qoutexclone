import { expect, test } from '@playwright/test';
import {
  ADMIN,
  accountMenu as menu,
  accountPill as pill,
  failOnPageErrors,
  login,
  openMarket,
  placeTrade,
  register,
} from './helpers';

test.describe('account switcher', () => {
  test('moves between live and practice money, and tops the practice balance up', async ({ page }) => {
    const errors = failOnPageErrors(page);
    await register(page);

    // a new account starts on practice, and says so
    await expect(pill(page)).toHaveAttribute('aria-label', 'Trading account: Practice');
    await pill(page).click();
    await expect(menu(page).getByRole('menuitem', { name: /Live account/ })).toBeVisible();
    await expect(menu(page).getByRole('menuitem', { name: /Practice account/ })).toBeVisible();

    // Escape closes it, and the choice is the trader's own
    await page.keyboard.press('Escape');
    await expect(menu(page)).toHaveCount(0);

    await pill(page).click();
    await menu(page)
      .getByRole('menuitem', { name: /Live account/ })
      .click();
    await expect(pill(page)).toHaveAttribute('aria-label', 'Trading account: Live');

    // the active account lives on the account, so a reload keeps it
    await page.reload();
    await expect(pill(page)).toHaveAttribute('aria-label', 'Trading account: Live');

    // spend some practice money, then top it back up
    await pill(page).click();
    await menu(page)
      .getByRole('menuitem', { name: /Practice account/ })
      .click();
    await openMarket(page, 'EURUSD_OTC', 'EUR/USD (OTC)');
    await placeTrade(page, 'Higher', '1m');
    await expect(pill(page)).not.toHaveText(/10,000\.00/);

    await pill(page).click();
    await menu(page)
      .getByRole('menuitem', { name: /Top up practice/ })
      .click();
    await expect(page.getByText(/Practice balance topped up/)).toBeVisible();
    await expect(pill(page)).toContainText('10,000.00');

    expect(errors).toEqual([]);
  });

  test('offers the top-up only once the balance has run down, when an operator says so', async ({
    browser,
  }) => {
    const adminContext = await browser.newContext();
    const traderContext = await browser.newContext();
    const admin = await adminContext.newPage();
    const trader = await traderContext.newPage();
    const errors = failOnPageErrors(admin, [/CERT_AUTHORITY/, /favicon/]);

    try {
      await login(admin, ADMIN);
      await admin.goto('/admin/settings');
      await admin.locator('#setting-trading\\.practiceRefillBelow').fill('100000');
      await admin.click('button:has-text("Save")');
      await expect(admin.getByText('Settings saved')).toBeVisible();

      await register(trader);
      await pill(trader).click();
      const topUp = menu(trader).getByRole('menuitem', { name: /Top up practice/ });
      // a full practice balance does not need one, and the button says why
      await expect(topUp).toBeDisabled();
      await expect(topUp).toContainText('Available below $1,000.00');

      expect(errors).toEqual([]);
    } finally {
      await admin.goto('/admin/settings');
      await admin
        .locator('div', { has: admin.locator('#setting-trading\\.practiceRefillBelow') })
        .locator('button:has-text("Reset")')
        .first()
        .click();
      await adminContext.close();
      await traderContext.close();
    }
  });

  test('lists a joined tournament as its own chips, and stakes from them', async ({ browser }) => {
    const adminContext = await browser.newContext();
    const traderContext = await browser.newContext();
    const admin = await adminContext.newPage();
    const trader = await traderContext.newPage();
    const adminErrors = failOnPageErrors(admin, [/CERT_AUTHORITY/, /favicon/]);
    const traderErrors = failOnPageErrors(trader);
    const name = `E2E Cup ${Date.now()}`;

    try {
      await login(admin, ADMIN);
      await admin.goto('/admin/tournaments');
      await admin.fill('#t-name', name);
      // free to enter, so a brand-new account can join it
      await admin.fill('#t-fee', '0');
      await admin.fill('#t-pool', '100');
      await admin.fill('#t-chips', '500');
      await admin.fill('#t-split', '100');
      await admin.click('button:has-text("Create tournament")');
      await expect(admin.getByText('Tournament created')).toBeVisible();

      const row = admin.getByRole('row', { name: new RegExp(name.replace(/\s/g, '\\s')) }).first();
      const start = row.getByRole('button', { name: 'Start' });
      if (await start.isVisible()) {
        await start.click();
        await expect(admin.getByText('Tournament started')).toBeVisible();
      }

      await register(trader);
      await trader.goto('/tournaments');
      const card = trader.locator('li, div').filter({ hasText: name }).last();
      await card.getByRole('button', { name: /Join/ }).click();
      await expect(trader.getByText(/Joined/)).toBeVisible();

      // the tournament is now an account of its own, in chips rather than dollars
      await pill(trader).click();
      const entry = menu(trader).getByRole('menuitem', { name: new RegExp(name.split(' ')[2]) });
      await expect(entry).toContainText('chips');
      await entry.click();
      await expect(pill(trader)).toHaveAttribute('aria-label', `Trading account: ${name}`);
      // 500 chips, as the tournament was set up with
      await expect(pill(trader)).toContainText('500.00');

      // and a position taken now is staked in chips
      await trader.goto('/trade');
      await openMarket(trader, 'EURUSD_OTC', 'EUR/USD (OTC)');
      await placeTrade(trader, 'Higher', '1m');
      const positions = trader.getByRole('region', { name: 'Positions' });
      await expect(positions.getByRole('tab', { name: /Open \(1\)/ })).toBeVisible({ timeout: 20_000 });
      // the chips paid for it: $10 of the 500, and not a cent of live money
      await expect(pill(trader)).toContainText('490.00');

      expect(adminErrors).toEqual([]);
      expect(traderErrors).toEqual([]);
    } finally {
      // leave the tournament finished, so it stops appearing as an open contest
      await admin.goto('/admin/tournaments');
      const row = admin.getByRole('row', { name: new RegExp(name.replace(/\s/g, '\\s')) }).first();
      const finish = row.getByRole('button', { name: 'Finish & pay' });
      if (await finish.isVisible().catch(() => false)) {
        await finish.click();
        await row.getByRole('button', { name: 'Confirm payout' }).click();
      }
      await adminContext.close();
      await traderContext.close();
    }
  });
});
