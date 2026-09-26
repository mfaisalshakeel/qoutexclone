import { expect, test } from '@playwright/test';
import { ADMIN, adminApiToken, failOnPageErrors, login, newCredentials, register } from './helpers';

/**
 * The provider framework, end to end.
 *
 * These three drive the API directly — the same calls the admin screen
 * itself makes — because what they check is that an edit actually reaches a
 * trader's deposit, not how the form that made it is laid out. The screen's
 * own UI (the fields it shows, saving through it, the identity fields it
 * keeps read-only) is covered separately, in "the admin screen edits fees,
 * limits and countries, and leaves identity fields alone" below.
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

  test('the admin screen edits fees, limits and countries, and leaves identity fields alone', async ({
    page,
  }) => {
    const errors = failOnPageErrors(page);
    await login(page, ADMIN);
    await page.goto('/admin/payment-methods');

    const row = page.getByRole('row', { name: /Tether \(TRC-20\)/i });
    await expect(row).toBeVisible();
    await row.getByText(/Tether \(TRC-20\)/i).click();

    const dialog = page.getByRole('dialog', { name: 'Edit payment method' });
    await expect(dialog).toBeVisible();
    // the identity line is shown, plainly marked as not editable — not a form field
    await expect(dialog.getByText(/USDT.*TRC20.*crypto/i)).toBeVisible();

    const newFee = '2.5';
    await page.fill('#pm-fee-pct', newFee);
    await page.fill('#pm-max-deposit', '3000');
    await page.fill('#pm-countries', 'us, gb , de');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Saved')).toBeVisible();

    // reopen and confirm every value round-tripped through the server
    await row.getByText(/Tether \(TRC-20\)/i).click();
    await expect(page.locator('#pm-fee-pct')).toHaveValue(newFee);
    await expect(page.locator('#pm-max-deposit')).toHaveValue('3000');
    await expect(page.locator('#pm-countries')).toHaveValue('US, GB, DE');
    await page.getByRole('button', { name: 'Close ✕' }).click();

    // restore it so the money-path tests above keep their own starting point
    await row.getByText(/Tether \(TRC-20\)/i).click();
    await page.fill('#pm-fee-pct', '0');
    await page.fill('#pm-max-deposit', '0');
    await page.fill('#pm-countries', '');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Saved')).toBeVisible();

    expect(errors).toEqual([]);
  });
});
