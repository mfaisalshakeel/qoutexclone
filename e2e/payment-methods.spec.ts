import { expect, test } from '@playwright/test';
import { adminApiToken, failOnPageErrors, newCredentials, register } from './helpers';

/**
 * The provider framework, end to end.
 *
 * There is no dedicated admin screen yet — it lands with the rest of Growth
 * in Phase 6 — so an operator's edit is made through the API directly here,
 * exactly as a future screen would call it, and what is checked is that the
 * edit actually reaches a trader's deposit.
 */
test.describe('payment methods', () => {
  test('an operator-raised minimum refuses a deposit below it, then is restored', async ({ page }) => {
    const errors = failOnPageErrors(page);
    await page.goto('/login');
    const token = await adminApiToken(page.request);

    const list = await page.request.get('/api/admin/payment-methods', {
      headers: { authorization: `Bearer ${token}` },
    });
    const { methods } = await list.json();
    const trc20 = methods.find((m: { key: string }) => m.key === 'crypto-usdt-trc20');
    expect(trc20).toBeTruthy();
    const originalMin = trc20.minDepositCents;

    // raise the minimum well above what the trader is about to try
    const patch = await page.request.patch(`/api/admin/payment-methods/${trc20.id}`, {
      headers: { authorization: `Bearer ${token}` },
      data: { minDepositCents: 20_000 },
    });
    expect(patch.ok()).toBeTruthy();

    try {
      await register(page, newCredentials('paymethod'));
      await page.goto('/wallet');
      await page.locator('button:has-text("Tether (TRC-20)")').first().click();
      await page.fill('input[type=number]', '100');
      // the client already knows the new minimum from /wallet/methods and
      // disables the button rather than round-tripping to be told no
      await expect(page.getByText(/Minimum deposit .* is \$200/)).toBeVisible();
      await expect(page.getByRole('button', { name: 'Get deposit address' })).toBeDisabled();
    } finally {
      await page.request.patch(`/api/admin/payment-methods/${trc20.id}`, {
        headers: { authorization: `Bearer ${token}` },
        data: { minDepositCents: originalMin },
      });
    }

    expect(errors).toEqual([]);
  });

  test('a disabled method disappears from the wallet, then reappears', async ({ page }) => {
    await page.goto('/login');
    const token = await adminApiToken(page.request);

    const list = await page.request.get('/api/admin/payment-methods', {
      headers: { authorization: `Bearer ${token}` },
    });
    const { methods } = await list.json();
    const trc20 = methods.find((m: { key: string }) => m.key === 'crypto-usdt-trc20');

    await page.request.patch(`/api/admin/payment-methods/${trc20.id}`, {
      headers: { authorization: `Bearer ${token}` },
      data: { enabled: false },
    });

    try {
      await register(page, newCredentials('paymethod-off'));
      await page.goto('/wallet');
      await expect(page.locator('button:has-text("Tether (TRC-20)")')).toHaveCount(0);
    } finally {
      await page.request.patch(`/api/admin/payment-methods/${trc20.id}`, {
        headers: { authorization: `Bearer ${token}` },
        data: { enabled: true },
      });
    }

    await page.goto('/wallet');
    await expect(page.locator('button:has-text("Tether (TRC-20)")').first()).toBeVisible();
  });

  test('every field on the structural side is refused as an edit', async ({ page }) => {
    await page.goto('/login');
    const token = await adminApiToken(page.request);
    const list = await page.request.get('/api/admin/payment-methods', {
      headers: { authorization: `Bearer ${token}` },
    });
    const { methods } = await list.json();
    const trc20 = methods.find((m: { key: string }) => m.key === 'crypto-usdt-trc20');

    // the schema simply ignores fields it does not recognise, so this proves
    // the key stays put rather than that the request was rejected
    const patch = await page.request.patch(`/api/admin/payment-methods/${trc20.id}`, {
      headers: { authorization: `Bearer ${token}` },
      data: { key: 'hijacked', provider: 'CARD', currency: 'EUR' },
    });
    expect(patch.ok()).toBeTruthy();
    const { method } = await patch.json();
    expect(method.key).toBe('crypto-usdt-trc20');
    expect(method.provider).toBe('CRYPTO');
    expect(method.currency).toBe('USDT');
  });
});
