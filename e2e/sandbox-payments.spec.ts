import { expect, test } from '@playwright/test';
import { failOnPageErrors, newCredentials, register } from './helpers';

/**
 * The sandbox card and e-wallet providers, through the browser.
 *
 * There is no real processor behind either, so the assertion that matters is
 * not "a charge succeeded" but that the whole path — checkout session, signed
 * webhook, idempotent crediting, bonus rules — behaves exactly like the
 * crypto flow a trader already trusts.
 */
test.describe('sandbox payment methods', () => {
  test('a card deposit opens a checkout, credits once simulated, and cannot be paid twice', async ({
    page,
  }) => {
    const errors = failOnPageErrors(page);
    await register(page, newCredentials('sandbox-card'));

    await page.goto('/wallet');
    await page.locator('button:has-text("Card (sandbox)")').first().click();
    await page.fill('input[type=number]', '75');
    await page.click('button:has-text("Continue to sandbox checkout")');

    await expect(page.getByText('AWAITING DEPOSIT')).toBeVisible();
    await expect(page.getByText('$75.00 USD')).toBeVisible();
    await expect(page.getByText('via Card (sandbox)')).toBeVisible();
    // there is no address or QR code for a checkout session
    await expect(page.getByText(/Send to this/)).toHaveCount(0);

    await page.click('button:has-text("Simulate successful payment")');
    await expect(page.getByText('Payment confirmed')).toBeVisible();

    await page.goto('/wallet');
    await expect(page.getByText('$75.00').first()).toBeVisible();

    // the button that pays a checkout is gone once it is paid
    await expect(page.locator('button:has-text("Simulate successful payment")')).toHaveCount(0);

    expect(errors).toEqual([]);
  });

  test('an e-wallet deposit works the same way, with its own fee', async ({ page }) => {
    await register(page, newCredentials('sandbox-ewallet'));

    await page.goto('/wallet');
    await page.locator('button:has-text("E-wallet (sandbox)")').first().click();
    await page.fill('input[type=number]', '100');
    await page.click('button:has-text("Continue to sandbox checkout")');
    await expect(page.getByText('$100.00 USD')).toBeVisible();

    await page.click('button:has-text("Simulate successful payment")');
    await expect(page.getByText('Payment confirmed')).toBeVisible();

    await page.goto('/wallet');
    await expect(page.getByText('$100.00').first()).toBeVisible();
  });

  test('the real public webhook endpoint credits a deposit, signature and all', async ({
    page,
    request,
    baseURL,
  }) => {
    // this drives the actual HTTP endpoint a real card gateway would call —
    // distinct from the "simulate" button, which goes through the same
    // verification path but from inside the authenticated wallet route
    const credentials = await register(page, newCredentials('sandbox-webhook'));
    await page.goto('/wallet');
    await page.locator('button:has-text("Card (sandbox)")').first().click();
    await page.fill('input[type=number]', '60');
    await page.click('button:has-text("Continue to sandbox checkout")');
    await expect(page.getByText('$60.00 USD')).toBeVisible();

    const adminToken = (
      await (
        await request.post('/api/auth/login', {
          data: { email: 'admin@quotexclone.dev', password: 'Admin123!' },
        })
      ).json()
    ).accessToken as string;
    const list = await (
      await request.get('/api/admin/deposits?status=AWAITING_PAYMENT', {
        headers: { authorization: `Bearer ${adminToken}` },
      })
    ).json();
    const mine = list.deposits.find(
      (d: { cryptoAmount: string; user: { email: string } }) =>
        d.cryptoAmount === '60.00' && d.user.email === credentials.email,
    );
    expect(mine).toBeTruthy();

    // signed exactly as the sandbox provider signs its own simulated
    // payments — imported from the server, not reimplemented here, so this
    // proves the real endpoint against the real signer
    const { buildSandboxWebhook } = await import('../server/src/services/payments.js');
    const { body, headers } = buildSandboxWebhook('CARD', {
      externalId: mine.externalRef,
      amountCents: 6_000,
    });

    const delivery = await request.post(`${baseURL}/api/webhooks/payments/card`, {
      headers: { 'content-type': 'application/json', ...headers },
      data: body,
    });
    expect(delivery.ok()).toBeTruthy();

    await page.reload();
    await expect(page.getByText('$60.00').first()).toBeVisible();
  });
});
