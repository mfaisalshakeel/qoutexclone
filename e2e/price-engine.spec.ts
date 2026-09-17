import { expect, test } from '@playwright/test';
import { ADMIN, failOnPageErrors, login } from './helpers';

test.describe('broker price engine', () => {
  test('previews parameters, saves them and restores the defaults', async ({ page }) => {
    const errors = failOnPageErrors(page, [/CERT_AUTHORITY/, /favicon/]);
    await login(page, ADMIN);

    await page.goto('/admin/price-engine');
    await expect(page.getByRole('heading', { name: 'Price engine', level: 1 })).toBeVisible();

    // the preview is generated server-side from the engine, not from live ticks
    const preview = page.locator('svg[aria-label="Generated price preview"]');
    await expect(preview).toBeVisible();
    const quietBars = await preview.locator('rect').count();
    expect(quietBars).toBeGreaterThan(50);

    await page.fill('#otc-baseVolatility', '0.006');
    await page.click('button:has-text("Preview")');
    await page.waitForTimeout(1000);
    await expect(preview).toBeVisible();

    await page.click('button:has-text("Save")');
    await expect(page.getByText('Engine updated')).toBeVisible();

    await page.click('button:has-text("Reset")');
    await expect(page.getByText(/Restored the market defaults/i)).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('refuses parameters outside the safe range', async ({ page, request }) => {
    await login(page, ADMIN);
    const token = await page.evaluate(() => localStorage.getItem('qx.access'));

    const rejected = await request.put('/api/admin/otc/EURUSD_OTC', {
      headers: { authorization: `Bearer ${token}` },
      data: { overrides: { baseVolatility: 5, maxTickMove: 9 } },
    });
    expect(rejected.status()).toBe(400);
    expect((await rejected.json()).error.code).toBe('validation_error');
  });
});
