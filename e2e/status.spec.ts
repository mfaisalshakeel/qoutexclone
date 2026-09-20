import { expect, test } from '@playwright/test';
import { failOnPageErrors, fundAccount, newCredentials, register, useLiveAccount } from './helpers';
import { openMarket } from './helpers';

/**
 * Status levels through the browser.
 *
 * The seeded defaults are $1,000 of lifetime deposits for the second level and
 * $10,000 for the third, so a freshly registered account starts at the bottom
 * and a single funded deposit moves the progress bar without promoting anyone —
 * which is exactly the state the page has to read well in.
 */
test.describe('status levels', () => {
  test('shows where a new trader stands and what the levels are worth', async ({ page }) => {
    const errors = failOnPageErrors(page);
    await register(page, newCredentials('status'));

    await page.goto('/account/status');
    await expect(page.getByRole('heading', { name: 'Status', level: 1 })).toBeVisible();

    // the whole ladder, not just the rung they are on
    await expect(page.getByRole('heading', { name: 'Standard', level: 2 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Pro', level: 2 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'VIP', level: 2 })).toBeVisible();
    await expect(page.getByText('+4% payout on your positions')).toBeVisible();

    const bar = page.getByRole('progressbar');
    await expect(bar).toHaveAttribute('aria-valuenow', '0');
    await expect(page.getByText('$1,000.00 to Pro')).toBeVisible();

    // and it is reachable from the account page
    await page.goto('/account');
    await page.getByRole('link', { name: /^Status/ }).click();
    await expect(page.getByRole('heading', { name: 'Status', level: 1 })).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('a deposit moves the progress bar', async ({ page }) => {
    await register(page, newCredentials('status-dep'));

    await page.goto('/account/status');
    await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');

    await fundAccount(page, '$250');

    await page.goto('/account/status');
    // $250 of a $1,000 band
    await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25');
    await expect(page.getByText('$750.00 to Pro')).toBeVisible();
  });

  test('the ticket quotes the market payout for a trader with no status yet', async ({ page }) => {
    await register(page, newCredentials('status-ticket'));
    await openMarket(page, 'EURUSD_OTC', 'EUR/USD (OTC)');

    const ticket = page.getByRole('region', { name: 'Order ticket' });
    // nothing claims a bonus this trader has not earned
    await expect(ticket.getByText(/bonus/)).toHaveCount(0);
  });

  test('the header carries the level once a trader has one', async ({ page }) => {
    const credentials = newCredentials('status-header');
    await register(page, credentials);
    // a fresh account is on the first level, which the header still names
    await expect(page.getByRole('link', { name: 'Standard' })).toBeVisible();
    await useLiveAccount(page);
    await expect(page.getByRole('link', { name: 'Standard' })).toBeVisible();
  });
});
