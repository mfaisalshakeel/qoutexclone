import { expect, test } from '@playwright/test';
import { failOnPageErrors, newCredentials, register } from './helpers';

/**
 * Limits a trader sets on themselves.
 *
 * The page's promise is that these are enforced on the server and that a
 * loosening has to wait, so both are what the spec checks — not that the form
 * holds the number it was given.
 */
test.describe('responsible trading', () => {
  test('saves a limit immediately, and makes loosening it wait', async ({ page }) => {
    const errors = failOnPageErrors(page);
    await register(page, newCredentials('limits'));

    await page.goto('/account/limits');
    await expect(page.getByRole('heading', { name: 'Responsible trading', level: 1 })).toBeVisible();

    await page.fill('#loss', '50');
    await page.getByRole('button', { name: 'Save limits' }).click();
    await expect(page.getByText('Limits saved')).toBeVisible();
    await expect(page.locator('#loss')).toHaveValue('50');

    // raising it is not immediate
    await page.fill('#loss', '500');
    await page.getByRole('button', { name: 'Save limits' }).click();
    await expect(page.getByText('A change is waiting')).toBeVisible();
    await expect(page.getByText('Daily loss limit → $500.00')).toBeVisible();
    // and the old, stricter number is still the one in force
    await expect(page.locator('#loss')).toHaveValue('50');

    await page.getByRole('button', { name: 'Cancel it' }).click();
    await expect(page.getByText('A change is waiting')).toBeHidden();

    expect(errors).toEqual([]);
  });

  test('closes the account for a period and leaves withdrawals open', async ({ page }) => {
    await register(page, newCredentials('exclude'));

    await page.goto('/account/limits');
    await page.getByRole('button', { name: '7 days' }).click();
    await expect(page.getByText('This cannot be undone')).toBeVisible();
    await page.getByRole('button', { name: 'Yes, close it' }).click();

    await expect(page.getByText('Your account is closed until further notice')).toBeVisible();

    // said on every page, with the way to the money named
    await page.goto('/account');
    await expect(page.getByText(/Trading and deposits are off\. Withdrawals are open\./)).toBeVisible();

    // and the server refuses a deposit — the message below the form is the
    // server's, not the banner's, so the last match is the one that matters
    await page.goto('/wallet');
    await page.locator('button:has-text("Tether (TRC-20)")').first().click();
    await page.locator('button:has-text("$100")').first().click();
    await page.click('button:has-text("Get deposit address")');
    await expect(page.getByText(/close your account/).last()).toBeVisible();
  });
});
