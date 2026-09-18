import { expect, test } from '@playwright/test';
import { TRADER, failOnPageErrors, login, openMarket } from './helpers';

test.describe('expiry modes', () => {
  test('buys a clock-time expiry with a live countdown to its cut-off', async ({ page }) => {
    const errors = failOnPageErrors(page);
    await login(page, TRADER);
    // an always-open market, so these specs do not depend on the clock or on
    // whichever market another spec left on the account
    await openMarket(page, 'EURUSD_OTC', 'EUR/USD (OTC)');

    const ticket = page.getByRole('region', { name: 'Order ticket' });
    const expiry = ticket.getByRole('group', { name: 'Expiry' });

    // duration is the default, and the market's own list is what is offered
    await expect(expiry.getByRole('button', { name: 'Duration' })).toHaveAttribute('aria-pressed', 'true');
    await expect(expiry.getByRole('button', { name: '1m', exact: true })).toBeVisible();

    await expiry.getByRole('button', { name: 'Clock time' }).click();
    await expect(expiry.getByRole('button', { name: 'Clock time' })).toHaveAttribute('aria-pressed', 'true');

    // boundaries arrive from the server with the time left to buy each one
    const slot = expiry.getByRole('button', { name: /to buy/ }).first();
    await expect(slot).toBeVisible({ timeout: 15_000 });
    await expect(ticket.getByText(/Expires at \d{1,2}:\d{2}/)).toBeVisible();

    // the countdown really counts down
    const first = await slot.innerText();
    await expect(slot).not.toHaveText(first, { timeout: 5_000 });

    await slot.click();
    await expect(slot).toHaveAttribute('aria-pressed', 'true');

    // and the position opens on that boundary
    await ticket.getByRole('button', { name: /Higher/ }).click();
    await expect(page.getByText(/expires in/).first()).toBeVisible({ timeout: 15_000 });

    const positions = page.getByRole('main');
    await expect(positions.getByText(TRADER.email)).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('offers the durations a market allows, and nothing else', async ({ page }) => {
    const errors = failOnPageErrors(page);
    await login(page, TRADER);
    // an always-open market, so these specs do not depend on the clock or on
    // whichever market another spec left on the account
    await openMarket(page, 'EURUSD_OTC', 'EUR/USD (OTC)');

    const expiry = page.getByRole('region', { name: 'Order ticket' }).getByRole('group', { name: 'Expiry' });

    // every duration button is one the catalogue offered for this market
    const offered: string[] = await page.evaluate(async () => {
      const res = await fetch('/api/market/assets');
      const data = await res.json();
      const symbol = localStorage.getItem('qx.symbol') ?? data.assets[0].symbol;
      const asset = data.assets.find((a: { symbol: string }) => a.symbol === symbol) ?? data.assets[0];
      const fmt = (s: number) =>
        s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : `${Math.round(s / 3600)}h`;
      return (asset.durations as number[]).slice(0, 8).map(fmt);
    });

    for (const label of offered) {
      await expect(expiry.getByRole('button', { name: label, exact: true })).toBeVisible();
    }
    expect(errors).toEqual([]);
  });
});
