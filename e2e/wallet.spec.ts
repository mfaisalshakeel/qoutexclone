import { expect, test } from '@playwright/test';
import { failOnPageErrors, fundAccount, newCredentials, register } from './helpers';

test.describe('wallet', () => {
  test('creates a crypto deposit invoice and credits it once confirmed', async ({ page }) => {
    const errors = failOnPageErrors(page, [/CERT_AUTHORITY/, /favicon/]);
    await register(page, newCredentials('deposit'));

    await page.goto('/wallet');
    await page.locator('button:has-text("Tether (TRC-20)")').first().click();
    await page.locator('button:has-text("$250")').first().click();
    await page.click('button:has-text("Get deposit address")');

    // the invoice locks a rate and shows the exact amount plus an address
    await expect(page.getByText('Awaiting deposit')).toBeVisible();
    await expect(page.getByText(/USDT/).first()).toBeVisible();
    await expect(page.locator('code').first()).toContainText(/^T[1-9A-HJ-NP-Za-km-z]{33}$/);

    // the mock chain watcher stands in for an on-chain payment
    await page.click('text=Simulate the incoming payment');
    await expect(page.getByText(/Confirming \d+\/\d+|Deposit credited/)).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText('Deposit credited')).toBeVisible({ timeout: 120_000 });

    expect(errors).toEqual([]);
  });

  test('blocks a withdrawal with no balance and rejects a bad address once funded', async ({ page }) => {
    await register(page, newCredentials('withdraw'));

    await page.goto('/wallet?tab=withdraw');
    await page.locator('button:has-text("Tether (TRC-20)")').first().click();
    await page.fill('#withdraw-address', 'TJRyWwFs9wTFGZg3JbrVriFbNfCug5tDeC');
    await page.fill('#withdraw-amount', '50');

    // the quote shows the fee split before anything is submitted
    await expect(page.getByText('You receive')).toBeVisible();
    // nothing deposited yet, so the request cannot be submitted at all
    await expect(page.getByText(/You can withdraw up to/i)).toBeVisible();
    await expect(page.locator('button:has-text("Request withdrawal")')).toBeDisabled();

    await fundAccount(page, '$250');

    await page.goto('/wallet?tab=withdraw');
    await page.locator('button:has-text("Tether (TRC-20)")').first().click();
    await page.fill('#withdraw-address', 'definitely-not-an-address');
    await page.fill('#withdraw-amount', '50');
    await expect(page.getByText('You receive')).toBeVisible();
    await page.click('button:has-text("Request withdrawal")');
    await expect(page.getByText(/does not look like a valid/i)).toBeVisible();
  });
});
