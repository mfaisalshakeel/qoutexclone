import { expect, test } from '@playwright/test';
import { TRADER, failOnPageErrors, login } from './helpers';

test.describe('pending orders', () => {
  test('places an order at a price, lists it apart, and cancels it', async ({ page }) => {
    const errors = failOnPageErrors(page);
    await login(page, TRADER);
    await page.waitForSelector('canvas');

    const ticket = page.getByRole('complementary').filter({ hasText: 'Payout' }).first();
    const panel = page.getByRole('complementary').filter({ hasText: 'Pending' }).first();

    await ticket.getByRole('group', { name: 'Order' }).getByRole('button', { name: 'Pending' }).click();
    await expect(ticket.getByRole('button', { name: 'At a price' })).toHaveAttribute('aria-pressed', 'true');

    // the level is seeded from the live price, so it has to be moved off it
    const level = ticket.getByLabel('Trigger price');
    await expect(level).not.toHaveValue('');
    const market = Number(await level.inputValue());
    expect(market).toBeGreaterThan(0);

    // a level sitting on the market is a market order, and the ticket says so
    await expect(ticket.getByText(/that is a market order/)).toBeVisible();

    // well above the market, so it will not fill during the test
    await level.fill((market * 1.5).toFixed(5));
    await expect(ticket.getByText(/fires on the way up/)).toBeVisible();

    await ticket.getByRole('button', { name: 'Order higher' }).click();
    await expect(page.getByText('Order placed')).toBeVisible({ timeout: 15_000 });

    // it is listed under Pending, not among the open positions
    await panel.getByRole('tab', { name: /Pending/ }).click();
    const row = panel.getByText(/Opens at or above/).first();
    await expect(row).toBeVisible();

    await panel.getByRole('button', { name: 'Cancel' }).first().click();
    await expect(panel.getByText('cancelled').first()).toBeVisible({ timeout: 15_000 });

    expect(errors).toEqual([]);
  });

  test('places an order at a time and refuses one in the past', async ({ page }) => {
    // the refusal is the point, so the 400 it causes is not a fault
    const errors = failOnPageErrors(page, [/status of 400/]);
    await login(page, TRADER);
    await page.waitForSelector('canvas');

    const ticket = page.getByRole('complementary').filter({ hasText: 'Payout' }).first();
    await ticket.getByRole('group', { name: 'Order' }).getByRole('button', { name: 'Pending' }).click();
    await ticket.getByRole('button', { name: 'At a time' }).click();

    const when = ticket.getByLabel('Trigger time');
    await expect(when).not.toHaveValue('');

    // a moment in the past is refused before the round trip
    await when.fill('2020-01-01T00:00');
    await expect(ticket.getByText('Pick a time in the future')).toBeVisible();
    await expect(ticket.getByRole('button', { name: 'Order higher' })).toBeDisabled();

    // an hour out is accepted
    const hourOut = new Date(Date.now() + 3_600_000);
    const pad = (value: number) => String(value).padStart(2, '0');
    await when.fill(
      `${hourOut.getFullYear()}-${pad(hourOut.getMonth() + 1)}-${pad(hourOut.getDate())}T${pad(hourOut.getHours())}:${pad(hourOut.getMinutes())}`,
    );
    await ticket.getByRole('button', { name: 'Order lower' }).click();
    await expect(page.getByText('Order placed')).toBeVisible({ timeout: 15_000 });

    const panel = page.getByRole('complementary').filter({ hasText: 'Pending' }).first();
    await panel.getByRole('tab', { name: /Pending/ }).click();
    await expect(panel.getByText(/Opens at /).first()).toBeVisible();

    // leave nothing behind
    await panel.getByRole('button', { name: 'Cancel' }).first().click();
    await expect(panel.getByText('cancelled').first()).toBeVisible({ timeout: 15_000 });

    expect(errors).toEqual([]);
  });
});
