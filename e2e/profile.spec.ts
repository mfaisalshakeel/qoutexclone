import { expect, test } from '@playwright/test';
import { failOnPageErrors, newCredentials, register } from './helpers';

/**
 * The profile.
 *
 * What is worth testing is that a preference survives a reload and reaches the
 * rest of the interface — a settings page that saves into a void is the
 * classic failure here.
 */
test.describe('profile', () => {
  test('saves an avatar, a timezone and a number format, and they stick', async ({ page }) => {
    const errors = failOnPageErrors(page);
    const credentials = newCredentials('profile');
    await register(page, credentials);

    await page.goto('/account');
    await expect(page.getByRole('heading', { name: 'Profile', level: 2 })).toBeVisible();

    await page.getByRole('button', { name: 'emerald' }).click();
    await page.fill('#timezone', 'Asia/Karachi');
    await page.selectOption('#numberFormat', 'de-DE');
    await page.fill('#name', 'Amelia Stone');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Profile updated')).toBeVisible();

    await page.reload();
    await expect(page.getByRole('button', { name: 'emerald' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#timezone')).toHaveValue('Asia/Karachi');
    await expect(page.locator('#numberFormat')).toHaveValue('de-DE');

    // and the format reaches the money shown elsewhere on the page
    await expect(page.getByText('$10.000,00').first()).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('refuses a timezone the server does not know', async ({ page }) => {
    await register(page, newCredentials('profile-tz'));
    await page.goto('/account');

    await page.fill('#timezone', 'Mars/Olympus');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText(/timezone is not one this server knows/)).toBeVisible();
  });

  test('turns a notification kind off and keeps the rest', async ({ page }) => {
    await register(page, newCredentials('profile-notify'));
    await page.goto('/account');

    const trades = page.getByLabel('Positions settling');
    await expect(trades).toBeChecked();
    await trades.uncheck();

    await page.reload();
    await expect(page.getByLabel('Positions settling')).not.toBeChecked();
    await expect(page.getByLabel('Tournaments')).toBeChecked();
  });
});
