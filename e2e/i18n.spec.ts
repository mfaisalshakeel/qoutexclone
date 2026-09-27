import { expect, test } from '@playwright/test';
import { ADMIN, adminApiToken, expectNoHorizontalScroll, failOnPageErrors, login } from './helpers';

test.describe('internationalisation', () => {
  test.beforeEach(async ({ request }) => {
    const token = await adminApiToken(request);
    const res = await request.patch('/api/admin/settings', {
      headers: { authorization: `Bearer ${token}` },
      data: { 'localisation.enabledLanguages': ['en', 'ar'] },
    });
    expect(res.ok()).toBeTruthy();
  });

  test.afterEach(async ({ request }) => {
    const token = await adminApiToken(request);
    await request.post('/api/admin/settings/localisation.enabledLanguages/reset', {
      headers: { authorization: `Bearer ${token}` },
    });
  });

  test('switching the footer language actually translates the page and flips text direction', async ({
    page,
  }) => {
    const errors = failOnPageErrors(page);
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');

    await page.getByLabel('Interface language').selectOption('ar');

    // a real Arabic string appears, not a machine placeholder or the untranslated English
    await expect(page.getByRole('navigation', { name: 'Site' }).getByText('الأسواق')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    await expect(page.getByText(/translation is on the way/i)).toHaveCount(0);

    expect(errors).toEqual([]);
  });

  test('the chosen language survives a reload', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Interface language').selectOption('ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    await expect(page.getByRole('navigation', { name: 'Site' }).getByText('الأسواق')).toBeVisible();
  });

  test('an operator-enabled language with no real translation shows the honest fallback note, not broken text', async ({
    page,
    request,
  }) => {
    const token = await adminApiToken(request);
    await request.patch('/api/admin/settings', {
      headers: { authorization: `Bearer ${token}` },
      data: { 'localisation.enabledLanguages': ['en', 'es'] },
    });

    await page.goto('/');
    await page.getByLabel('Interface language').selectOption('es');
    // the interface stays in English, and says so, rather than mixing languages
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(page.getByText(/translation is on the way/i)).toBeVisible();

    await request.post('/api/admin/settings/localisation.enabledLanguages/reset', {
      headers: { authorization: `Bearer ${token}` },
    });
  });

  test('Arabic (RTL) renders with no layout breakage or console errors at desktop and phone widths', async ({
    page,
  }) => {
    const errors = failOnPageErrors(page);

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await page.getByLabel('Interface language').selectOption('ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expectNoHorizontalScroll(page);

    for (const path of ['/markets', '/tournaments/overview', '/status', '/affiliate', '/help', '/about']) {
      await page.goto(path);
      await expectNoHorizontalScroll(page);
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await expectNoHorizontalScroll(page);
    for (const path of ['/markets', '/tournaments/overview', '/status', '/affiliate', '/help', '/about']) {
      await page.goto(path);
      await expectNoHorizontalScroll(page);
    }

    expect(errors).toEqual([]);
  });

  test('an authenticated trader keeps the English terminal regardless of the public-site language choice', async ({
    page,
  }) => {
    // the authenticated app is deliberately out of this translation's scope;
    // switching the public site's language must never leak into the terminal
    await page.goto('/');
    await page.getByLabel('Interface language').selectOption('ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

    await login(page, ADMIN);
    await expect(page).toHaveURL(/\/(trade|admin)/);
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  });
});
