import { expect, test } from '@playwright/test';
import { ADMIN, failOnPageErrors, login } from './helpers';

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
});
