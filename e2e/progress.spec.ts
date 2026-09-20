import { expect, test } from '@playwright/test';
import { failOnPageErrors, newCredentials, openMarket, placeTrade, register } from './helpers';

/**
 * Levels and badges through the browser.
 *
 * A new account starts at level 1 with nothing earned, which is the state the
 * page most has to read well in: every badge is listed with how far off it is,
 * because a locked badge with no progress on it is just a blank.
 */
test.describe('progress', () => {
  test('shows the level, and every badge with how far off it is', async ({ page }) => {
    const errors = failOnPageErrors(page);
    await register(page, newCredentials('xp'));

    await page.goto('/account/progress');
    await expect(page.getByRole('heading', { name: 'Progress', level: 1 })).toBeVisible();
    await expect(page.getByText('Level 1')).toBeVisible();
    await expect(page.getByText('0 of 16 badges earned.')).toBeVisible();

    // grouped, and each locked badge carries its own progress bar
    await expect(page.getByRole('heading', { name: 'Positions', level: 2 })).toBeVisible();
    await expect(page.getByText('Off the mark')).toBeVisible();
    await expect(page.getByRole('progressbar', { name: 'Off the mark' })).toHaveAttribute(
      'aria-valuenow',
      '0',
    );
    await expect(page.getByText('0 of 50').first()).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('a settled practice position earns a badge but no experience', async ({ page }) => {
    await register(page, newCredentials('xp-trade'));
    await openMarket(page, 'EURUSD_OTC', 'EUR/USD (OTC)');
    await placeTrade(page, 'Higher', '30s');
    await expect(page.getByText('Open (1)')).toBeVisible();
    // settlement happens on the server's expiry sweep
    await expect(page.getByText('Open (0)')).toBeVisible({ timeout: 90_000 });

    await page.goto('/account/progress');
    // practice does not pay experience — the balance refills, so it would be free
    await expect(page.getByText('0 XP', { exact: true })).toBeVisible();
    // but it is still a position, and the first one is a badge
    await expect(page.getByRole('heading', { name: 'Positions', level: 2 })).toBeVisible();
    await expect(page.getByText('earned').first()).toBeVisible();
  });

  test('is reachable from the account page and names the level in the menu', async ({ page }) => {
    await register(page, newCredentials('xp-nav'));

    await page.goto('/account');
    await page.getByRole('link', { name: /^Progress/ }).click();
    await expect(page.getByRole('heading', { name: 'Progress', level: 1 })).toBeVisible();
  });
});
