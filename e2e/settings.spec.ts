import { expect, test } from '@playwright/test';
import { ADMIN, failOnPageErrors, login, newCredentials, openMarket, register } from './helpers';

test.describe('runtime settings', () => {
  test('an admin change reaches traders without a restart', async ({ page, request }) => {
    const errors = failOnPageErrors(page, [/CERT_AUTHORITY/, /favicon/]);
    await login(page, ADMIN);

    await page.goto('/admin/settings');
    await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();

    // the fee is public configuration, so the wallet endpoint must follow it
    const feeInput = page.locator('#setting-wallet\\.withdrawFeePct');
    await feeInput.fill('3');
    await page.click('button:has-text("Save")');
    await expect(page.getByText('Settings saved')).toBeVisible();

    const publicSettings = await request.get('/api/market/settings');
    expect(publicSettings.ok()).toBeTruthy();
    expect((await publicSettings.json()).settings['wallet.withdrawFeePct']).toBe(3);

    // and it is persisted, not just cached in the page
    await page.reload();
    await expect(page.locator('#setting-wallet\\.withdrawFeePct')).toHaveValue('3');

    // reset leaves no override behind
    await page
      .locator('div', { has: page.locator('#setting-wallet\\.withdrawFeePct') })
      .locator('button:has-text("Reset")')
      .first()
      .click();
    await expect(page.getByText(/restored to default/i)).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('rejects a value the registry does not allow', async ({ page }) => {
    await login(page, ADMIN);
    await page.goto('/admin/settings');
    await page.locator('#setting-wallet\\.withdrawFeePct').fill('500');
    await page.click('button:has-text("Save")');
    await expect(page.getByText(/Could not save/i)).toBeVisible();
  });

  test('maintenance mode pauses trading for a trader and never for the admin', async ({ browser }) => {
    const adminContext = await browser.newContext();
    const admin = await adminContext.newPage();
    const adminErrors = failOnPageErrors(admin);
    await login(admin, ADMIN);
    await admin.goto('/admin/settings');

    const traderContext = await browser.newContext();
    const trader = await traderContext.newPage();
    const traderErrors = failOnPageErrors(trader);
    await register(trader, newCredentials('maint'));
    await openMarket(trader, 'EURUSD_OTC', 'EUR/USD (OTC)');

    try {
      await admin.locator('#setting-general\\.maintenanceMode').click();
      await expect(admin.locator('#setting-general\\.maintenanceMode')).toHaveAttribute(
        'aria-checked',
        'true',
      );

      // the trader's own ticket says so, in place of the buy buttons — the
      // server's own enforcement of this same setting is covered directly in
      // middleware/auth.test.ts (requireNotInMaintenance), not re-proven here
      await trader.reload();
      await expect(trader.getByText('Trading is paused')).toBeVisible();
      await expect(trader.locator('button:visible:has-text("Higher")')).toHaveCount(0);

      // an admin trades straight through the same setting
      await admin.goto('/trade');
      await openMarket(admin, 'EURUSD_OTC', 'EUR/USD (OTC)');
      await expect(admin.getByText('Trading is paused')).toHaveCount(0);
      await expect(admin.locator('button:visible:has-text("Higher")').first()).toBeVisible();
    } finally {
      // leave the platform open for every other spec in the suite
      await admin.goto('/admin/settings');
      const toggle = admin.locator('#setting-general\\.maintenanceMode');
      if ((await toggle.getAttribute('aria-checked')) === 'true') await toggle.click();
      await expect(toggle).toHaveAttribute('aria-checked', 'false');
    }

    expect(adminErrors).toEqual([]);
    expect(traderErrors).toEqual([]);
    await adminContext.close();
    await traderContext.close();
  });

  test('a platform-wide stake ceiling reaches the ticket, not just the server', async ({ page }) => {
    const errors = failOnPageErrors(page);
    await login(page, ADMIN);
    await page.goto('/admin/settings');

    try {
      await page.locator('#setting-trading\\.maxStakeCents').fill('20000'); // $200
      await page.click('button:has-text("Save")');
      await expect(page.getByText('Settings saved')).toBeVisible();

      await page.goto('/trade');
      await openMarket(page, 'EURUSD_OTC', 'EUR/USD (OTC)');
      await page.getByLabel('Investment amount').fill('500');
      await expect(page.getByText('Maximum investment is $200.00')).toBeVisible();
      await expect(page.locator('button:visible:has-text("Higher")').first()).toBeDisabled();
    } finally {
      await page.goto('/admin/settings');
      await page
        .locator('div', { has: page.locator('#setting-trading\\.maxStakeCents') })
        .locator('button:has-text("Reset")')
        .first()
        .click();
      await expect(page.getByText(/restored to default/i)).toBeVisible();
    }

    expect(errors).toEqual([]);
  });
});
