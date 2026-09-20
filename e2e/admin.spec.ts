import { expect, test } from '@playwright/test';
import { ADMIN, failOnPageErrors, fundAccount, login, newCredentials, register } from './helpers';

test.describe('admin', () => {
  // this spec drives two complete journeys (fund, request, approve) back to back
  test.describe.configure({ timeout: 180_000 });

  test('approves a withdrawal end to end', async ({ browser }) => {
    const traderContext = await browser.newContext();
    const trader = await traderContext.newPage();
    const errors = failOnPageErrors(trader, [/CERT_AUTHORITY/, /favicon/]);

    // fund the account through the deposit flow, then request a payout
    const credentials = await register(trader, newCredentials('payout'));
    await fundAccount(trader, '$250');

    await trader.goto('/wallet?tab=withdraw');
    await trader.locator('button:has-text("Tether (TRC-20)")').first().click();
    await trader.fill('#withdraw-address', 'TJRyWwFs9wTFGZg3JbrVriFbNfCug5tDeC');
    await trader.fill('#withdraw-amount', '40');
    await expect(trader.getByText('You receive')).toBeVisible();
    await trader.click('button:has-text("Request withdrawal")');
    await expect(trader.getByText('In progress')).toBeVisible();

    const adminContext = await browser.newContext();
    const admin = await adminContext.newPage();
    await login(admin, ADMIN);
    await admin.goto('/admin/withdrawals');

    const row = admin.locator('tr').filter({ hasText: credentials.email });
    await expect(row).toBeVisible();
    await row.locator('button:has-text("Approve")').click();
    await expect(admin.getByText('Payout sent')).toBeVisible();
    await expect(row.getByText('completed')).toBeVisible();

    // the trader's held funds are consumed, not returned
    await trader.goto('/wallet?tab=history');
    await expect(trader.getByText('Withdrawal')).toBeVisible();

    expect(errors).toEqual([]);
    await traderContext.close();
    await adminContext.close();
  });

  test('back office sections all load', async ({ page }) => {
    const errors = failOnPageErrors(page, [/CERT_AUTHORITY/, /favicon/]);
    await login(page, ADMIN);

    for (const [path, heading] of [
      ['/admin', 'Dashboard'],
      ['/admin/withdrawals', 'Withdrawals'],
      ['/admin/deposits', 'Deposits'],
      ['/admin/users', 'Traders'],
      ['/admin/kyc', 'Identity verification'],
      ['/admin/support', 'Support desk'],
      ['/admin/tournaments', 'Tournaments'],
      ['/admin/promos', 'Promo codes'],
      ['/admin/assets', 'Markets'],
      ['/admin/email', 'Email'],
      ['/admin/audit', 'Audit log'],
    ] as const) {
      await page.goto(path);
      await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
    }

    expect(errors).toEqual([]);
  });

  test('a trader cannot reach the back office', async ({ page }) => {
    await register(page, newCredentials('guard'));
    await page.goto('/admin');
    await page.waitForURL('**/trade');
    await expect(page.locator('canvas').first()).toBeVisible();
  });
});
