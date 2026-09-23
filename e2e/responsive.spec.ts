import { expect, test } from '@playwright/test';
import {
  ADMIN,
  expectNoHorizontalScroll,
  failOnPageErrors,
  login,
  newCredentials,
  register,
} from './helpers';

/**
 * Runs under the `mobile` project (Pixel 7) as well as desktop, so every page
 * is checked for console errors and horizontal overflow at both sizes.
 */
test.describe('responsive shell', () => {
  test('trader pages fit the viewport and stay quiet', async ({ page }) => {
    const errors = failOnPageErrors(page, [/CERT_AUTHORITY/, /favicon/]);
    await register(page, newCredentials('resp'));

    for (const path of [
      '/trade',
      '/tournaments',
      '/wallet',
      '/wallet?tab=withdraw',
      '/history',
      '/leaderboard',
      '/account',
      '/account/security',
      '/account/status',
      '/account/progress',
      '/marketplace',
      '/account/limits',
    ]) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      await expectNoHorizontalScroll(page);
    }

    expect(errors).toEqual([]);
  });

  test('public and admin pages fit the viewport', async ({ page }) => {
    const errors = failOnPageErrors(page, [/CERT_AUTHORITY/, /favicon/]);

    for (const path of ['/', '/login', '/register', '/forgot-password', '/verify-email']) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      await expectNoHorizontalScroll(page);
    }

    await login(page, ADMIN);
    for (const path of [
      '/admin',
      '/admin/users',
      '/admin/withdrawals',
      '/admin/trades',
      '/admin/ledger',
      '/admin/referrals',
      '/admin/support',
      '/admin/tournaments',
      '/admin/promos',
      '/admin/marketplace-orders',
      '/admin/assets',
      '/admin/audit',
      '/admin/email',
      '/admin/payouts',
    ]) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      await expectNoHorizontalScroll(page);
    }

    // the payout rule form is the widest thing in the back office, so it is
    // checked open rather than only collapsed
    await page.getByRole('button', { name: 'New rule' }).click();
    await expect(page.getByLabel('Name')).toBeVisible();
    await expectNoHorizontalScroll(page);

    expect(errors).toEqual([]);
  });
});
