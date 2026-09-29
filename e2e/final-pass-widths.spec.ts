import { expect, test } from '@playwright/test';
import {
  ADMIN,
  TRADER,
  expectNoHorizontalScroll,
  failOnPageErrors,
  login,
  newCredentials,
  openTraderProfile,
  register,
} from './helpers';

/**
 * Final pass: every page at the exact five widths the roadmap names —
 * 360/390/768/1024/1440 — not just the two `responsive.spec.ts` already
 * covers via its projects' own device viewports (1440 desktop, ~412 Pixel 7).
 * One project only (see playwright.config.ts's testMatch): running this
 * again under the mobile project would override its Pixel 7 emulation with
 * the same five widths a second time, for the same result at real cost.
 */
const WIDTHS = [360, 390, 768, 1024, 1440];

test.describe('final pass: every required width', () => {
  test('trader and public pages, at every required width', async ({ page }) => {
    const errors = failOnPageErrors(page, [/CERT_AUTHORITY/, /favicon/]);
    await register(page, newCredentials('finalpass'));

    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      for (const path of [
        '/trade',
        '/tournaments',
        '/wallet',
        '/history',
        '/account',
        '/account/security',
        '/marketplace',
        '/',
        '/login',
        '/markets',
        '/help',
        '/about',
      ]) {
        await page.goto(path);
        await page.waitForLoadState('networkidle');
        await expectNoHorizontalScroll(page);
      }
    }

    expect(errors).toEqual([]);
  });

  test('admin back office, at every required width', async ({ page }) => {
    const errors = failOnPageErrors(page, [/CERT_AUTHORITY/, /favicon/]);
    await login(page, ADMIN);

    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      for (const path of [
        '/admin',
        '/admin/users',
        '/admin/withdrawals',
        '/admin/support',
        '/admin/tournaments',
        '/admin/content',
        '/admin/payouts',
      ]) {
        await page.goto(path);
        await page.waitForLoadState('networkidle');
        await expectNoHorizontalScroll(page);
      }

      // the widest form in the back office — opened and actually closed
      // again each time, not left stacking across widths (this form has no
      // Escape handler; "Cancel" is its real close control)
      await page.getByRole('button', { name: 'New rule' }).click();
      await expect(page.getByLabel('Name')).toBeVisible();
      await expectNoHorizontalScroll(page);
      await page.getByRole('button', { name: 'Cancel' }).click();
      await expect(page.getByLabel('Name')).toBeHidden();
    }

    // the busiest single page in the back office — once, at the narrowest
    // required width, rather than five round trips through login/search/open
    // in the same test (this repo's own e2e suite already treats that kind of
    // repetition as noise-prone; see admin.spec.ts's own profile coverage for
    // the other four widths' worth of confidence)
    await page.setViewportSize({ width: WIDTHS[0], height: 900 });
    await openTraderProfile(page, TRADER.email);
    await page.waitForLoadState('networkidle');
    await expectNoHorizontalScroll(page);

    expect(errors).toEqual([]);
  });
});
