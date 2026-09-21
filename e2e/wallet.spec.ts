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

  test('e-wallet withdrawal: card never offered as a destination, and the handle must look like an email', async ({
    page,
  }) => {
    // the bad-email submission below is deliberately refused with a 400
    const errors = failOnPageErrors(page, [/status of 400/]);
    await register(page, newCredentials('ewallet-withdraw'));
    await fundAccount(page, '$250');

    await page.goto('/wallet?tab=withdraw');
    // a card cannot receive an arbitrary payout, so it must never appear here
    // even though it is offered for deposits
    await expect(page.locator('button:has-text("Card (sandbox)")')).toHaveCount(0);

    await page.locator('button:has-text("E-wallet (sandbox)")').first().click();
    await page.fill('#withdraw-address', 'not-an-email');
    await page.fill('#withdraw-amount', '100');
    await expect(page.getByText('You receive')).toBeVisible();
    await page.click('button:has-text("Request withdrawal")');
    await expect(page.getByText('Enter the email address your e-wallet account uses')).toBeVisible();

    await page.fill('#withdraw-address', 'trader@example.test');
    // 1.5% of $100 on the seeded ewallet-usd method
    await expect(page.getByText('− $1.50')).toBeVisible();
    await page.click('button:has-text("Request withdrawal")');
    await expect(page.getByText('Withdrawal requested')).toBeVisible();
    await expect(page.getByText('In progress')).toBeVisible();
    await expect(page.getByText('Requested').first()).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('method grid shows the limit range up front, and a statement downloads as CSV and PDF', async ({
    page,
  }) => {
    const errors = failOnPageErrors(page);
    await register(page, newCredentials('statement'));
    await fundAccount(page, '$250');

    // the sandbox e-wallet method has a real min/max on both sides
    await page.goto('/wallet');
    await expect(page.getByText('$10–$10,000')).toBeVisible();
    await page.goto('/wallet?tab=withdraw');
    await expect(page.getByText('$10–$10,000')).toBeVisible();

    await page.goto('/wallet?tab=history');
    const [csv] = await Promise.all([
      page.waitForEvent('download'),
      page.click('button:has-text("Download CSV")'),
    ]);
    expect(csv.suggestedFilename()).toMatch(/^statement-.*\.csv$/);

    const [pdf] = await Promise.all([
      page.waitForEvent('download'),
      page.click('button:has-text("Download PDF")'),
    ]);
    expect(pdf.suggestedFilename()).toMatch(/^statement-.*\.pdf$/);

    expect(errors).toEqual([]);
  });
});
