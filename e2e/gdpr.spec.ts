import { expect, test } from '@playwright/test';
import { ADMIN, failOnPageErrors, login, newCredentials, openTraderProfile, register } from './helpers';

test.describe('GDPR data export and erasure', () => {
  test('an admin can download a trader’s data export, then erase their account data', async ({ page }) => {
    const errors = failOnPageErrors(page);
    const credentials = await register(page, newCredentials('gdpr'));

    // fresh session for the admin, same as the KYC flow — this page object was just the trader
    await page.evaluate(() => localStorage.clear());
    await login(page, ADMIN);
    await openTraderProfile(page, credentials.email);
    await expect(page.getByRole('heading', { name: credentials.name })).toBeVisible();

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('button:has-text("Export data")'),
    ]);
    expect(download.suggestedFilename()).toMatch(/^account-data-.*\.json$/);

    page.once('dialog', (dialog) => void dialog.accept('DELETE'));
    await page.click('button:has-text("Erase account data")');
    await expect(page.getByText('Account data erased')).toBeVisible();

    // the profile reloads under the same id, now anonymised
    await expect(page.getByRole('heading', { name: 'Deleted account' })).toBeVisible();
    await expect(page.getByText(/deleted-.*@deleted\.invalid/)).toBeVisible();
    await expect(page.getByRole('heading', { name: credentials.name })).toHaveCount(0);

    expect(errors).toEqual([]);
  });

  test('typing anything other than DELETE leaves the account untouched', async ({ page }) => {
    const credentials = await register(page, newCredentials('gdpr-cancel'));

    await page.evaluate(() => localStorage.clear());
    await login(page, ADMIN);
    await openTraderProfile(page, credentials.email);

    page.once('dialog', (dialog) => void dialog.accept('nope'));
    await page.click('button:has-text("Erase account data")');

    // no confirmation toast, and the trader's real name is still on screen
    await expect(page.getByText('Account data erased')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: credentials.name })).toBeVisible();
  });
});
