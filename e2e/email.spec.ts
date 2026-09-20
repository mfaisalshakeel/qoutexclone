import { expect, test } from '@playwright/test';
import { ADMIN, failOnPageErrors, login, newCredentials, register } from './helpers';

/**
 * Email in the back office.
 *
 * Nothing is delivered in a test run — no SMTP server is configured — which is
 * exactly the state these screens exist for: the outbox is the only record of
 * what the platform composed, and the test button is the only way to tell a
 * configuration that looks right from one that works.
 */
test.describe('admin email', () => {
  test('lists what the platform sent, and opens one', async ({ page, browser }) => {
    // the preview frame is sandboxed with no scripts: the browser says so once
    // per render, and that is the point of it
    const errors = failOnPageErrors(page, [/sandboxed and the 'allow-scripts'/]);

    // make something land in the outbox
    const credentials = newCredentials('mail');
    const trader = await browser.newContext();
    const traderPage = await trader.newPage();
    await register(traderPage, credentials);
    await trader.close();

    await login(page, ADMIN);
    await page.goto('/admin/email');
    await expect(page.getByRole('heading', { name: 'Email' })).toBeVisible();

    await page.getByLabel('Search by recipient').fill(credentials.email);
    const row = page.getByRole('button', { name: credentials.email });
    await expect(row).toBeVisible();

    await row.click();
    const preview = page.getByRole('dialog', { name: 'Email preview' });
    await expect(preview).toBeVisible();
    // the message is drawn in a sandboxed frame, as a mail client would
    await expect(preview.frameLocator('iframe').getByText('Confirm my email')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(preview).toBeHidden();

    expect(errors).toEqual([]);
  });

  test('filters by delivery status', async ({ page }) => {
    await login(page, ADMIN);
    await page.goto('/admin/email');

    // nothing is delivered without a mail server, so every row is queued
    await page
      .getByRole('group', { name: 'Delivery status' })
      .getByRole('button', { name: 'FAILED' })
      .click();
    await expect(page.getByText('No messages match that.')).toBeVisible();

    await page.getByRole('group', { name: 'Delivery status' }).getByRole('button', { name: 'All' }).click();
    await expect(page.getByText('No messages match that.')).toBeHidden();
  });

  test('previews every template before anyone receives one', async ({ page }) => {
    await login(page, ADMIN);
    await page.goto('/admin/email');
    await page.getByRole('tab', { name: 'Templates' }).click();

    await expect(page.getByText('Confirm your address')).toBeVisible();
    await expect(page.getByText('Deposit credited')).toBeVisible();
    await expect(page.getByText('Tournament result')).toBeVisible();

    await page.getByText('Deposit credited').click();
    const preview = page.getByRole('dialog', { name: 'Email preview' });
    await expect(preview).toBeVisible();
    await expect(preview.frameLocator('iframe').getByText('$250.00')).toBeVisible();
    await preview.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(preview).toBeHidden();
  });

  test('says plainly when there is no mail server to test', async ({ page }) => {
    await login(page, ADMIN);
    await page.goto('/admin/email');

    await page.getByLabel('Send a test email to').fill('operator@example.test');
    await page.getByRole('button', { name: 'Send test email' }).click();
    await expect(page.getByText('No SMTP server configured')).toBeVisible();
  });
});
