import { expect, test } from '@playwright/test';
import { failOnPageErrors, newCredentials, placeTrade, register } from './helpers';

test.describe('trading', () => {
  test('register, place a practice trade, see it settle and land in history', async ({ page }) => {
    const errors = failOnPageErrors(page, [/CERT_AUTHORITY/, /favicon/]);

    await register(page, newCredentials('trade'));

    // a new account starts on practice with $10,000
    await expect(page.getByText('Practice')).toBeVisible();
    await expect(page.getByText('$10,000.00')).toBeVisible();

    await placeTrade(page, 'Higher', '30s');
    await expect(page.getByText('Open (1)')).toBeVisible();

    // the stake leaves the balance immediately
    await expect(page.getByText('$10,000.00')).toBeHidden();

    // settlement happens on the server's expiry sweep
    await expect(page.getByText('Open (0)')).toBeVisible({ timeout: 90_000 });

    await page.goto('/history');
    await expect(page.getByText('Win rate')).toBeVisible();
    const rows = page.locator('table tbody tr, ul li');
    await expect(rows.first()).toBeVisible();
    await expect(page.getByText('BTCUSD').first()).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('rejects a stake above the practice balance', async ({ page }) => {
    await register(page, newCredentials('stake'));
    await page.waitForSelector('canvas');
    // the terminal mounts a ticket for each breakpoint; drive the visible one
    await page.locator('input[type=number]:visible').first().fill('99999');
    await expect(page.getByText(/Not enough balance/i)).toBeVisible();
    await expect(page.locator('button:visible:has-text("Higher")').first()).toBeDisabled();
  });
});
