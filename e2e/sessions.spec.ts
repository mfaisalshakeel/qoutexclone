import { expect, test, type APIRequestContext } from '@playwright/test';
import { ADMIN, failOnPageErrors, login, newCredentials, register } from './helpers';

/** Admin credentials through the API, so the spec can arrange state directly. */
async function adminToken(request: APIRequestContext): Promise<string> {
  const response = await request.post('/api/auth/login', { data: ADMIN });
  expect(response.ok()).toBeTruthy();
  return (await response.json()).accessToken;
}

const today = () => new Date().toISOString().slice(0, 10);

test.describe('trading sessions', () => {
  test('a holiday closes the market, and the OTC twin stays open', async ({ page, request }) => {
    const errors = failOnPageErrors(page, [/CERT_AUTHORITY/, /favicon/]);
    const token = await adminToken(request);
    const headers = { authorization: `Bearer ${token}` };

    const schedules = await request.get('/api/admin/schedules', { headers });
    const forex = (await schedules.json()).schedules.find(
      (schedule: { key: string }) => schedule.key === 'forex-24-5',
    );
    expect(forex).toBeDefined();

    const created = await request.post(`/api/admin/schedules/${forex.id}/holidays`, {
      headers,
      data: { date: today(), name: 'E2E closure' },
    });
    expect(created.ok()).toBeTruthy();
    const holidayId = (await created.json()).holiday.id;

    try {
      // the public catalogue reports it closed straight away
      const assets = await request.get('/api/market/assets');
      const list = (await assets.json()).assets as {
        symbol: string;
        isOpen: boolean;
        otcAlternative: string | null;
      }[];
      const spot = list.find((asset) => asset.symbol === 'EURUSD')!;
      const otc = list.find((asset) => asset.symbol === 'EURUSD_OTC')!;
      expect(spot.isOpen).toBe(false);
      expect(spot.otcAlternative).toBe('EURUSD_OTC');
      expect(otc.isOpen).toBe(true);

      // the server refuses a position on it
      const trader = await register(page, newCredentials('session'));
      expect(trader.email).toContain('@');
      const traderToken = await page.evaluate(() => localStorage.getItem('qx.access'));
      const rejected = await request.post('/api/trades', {
        headers: { authorization: `Bearer ${traderToken}` },
        data: { symbol: 'EURUSD', direction: 'UP', amount: 10, durationSec: 60, accountType: 'DEMO' },
      });
      expect(rejected.status()).toBe(409);
      expect((await rejected.json()).error.code).toBe('market_closed');

      // and the terminal explains it, then offers the OTC market
      await page.goto('/trade');
      await page.waitForSelector('canvas');
      await page.fill('input[placeholder="Search markets"]', 'EUR/USD');
      await page.locator('button:has-text("EUR/USD")').first().click();
      await expect(page.getByText(/is closed/).first()).toBeVisible();

      await page.locator('button:has-text("Trade the OTC market instead")').first().click();
      await expect(page.locator('button:visible:has-text("Higher")').first()).toBeEnabled();
      await expect(page.getByText('OTC').first()).toBeVisible();
    } finally {
      await request.delete(`/api/admin/schedules/${forex.id}/holidays/${holidayId}`, { headers });
    }

    expect(errors).toEqual([]);
  });

  test('the admin sessions screen lists calendars and their hours', async ({ page }) => {
    const errors = failOnPageErrors(page, [/CERT_AUTHORITY/, /favicon/]);
    await login(page, ADMIN);
    await page.goto('/admin/schedules');

    await expect(page.getByRole('heading', { name: 'Trading sessions', level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: /Forex 24\/5/ }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /US equities/ }).first()).toBeVisible();
    await expect(page.getByText(/Mon–Fri 13:30–20:00 UTC/).first()).toBeVisible();

    // expanding a calendar shows its weekly windows and holiday list
    await page.locator('button:has-text("US equities")').first().click();
    await expect(page.getByRole('heading', { name: 'Weekly hours (UTC)' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Holidays' })).toBeVisible();

    expect(errors).toEqual([]);
  });
});
