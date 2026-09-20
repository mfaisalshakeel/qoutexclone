import { expect, test } from '@playwright/test';
import { failOnPageErrors, fundAccount, newCredentials, openMarket, register } from './helpers';

/**
 * The shop through the browser.
 *
 * A new account has no points, so buying with money is the path a test can
 * take without settling hundreds of positions first — and it is the path that
 * moves a balance, which is the one worth watching.
 */
test.describe('marketplace', () => {
  test('lists what is on sale and says what each item does', async ({ page }) => {
    const errors = failOnPageErrors(page);
    await register(page, newCredentials('shop'));

    await page.goto('/marketplace');
    await expect(page.getByRole('heading', { name: 'Marketplace', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Payout booster +5%', level: 2 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Risk-free position', level: 2 })).toBeVisible();

    // a new account has no points, so the points buttons are out of reach
    await expect(page.getByRole('button', { name: /2,000 points/ })).toBeDisabled();
    await expect(page.getByText('Nothing here yet.')).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('buys a booster with money, starts it, and the ticket quotes the bonus', async ({ page }) => {
    await register(page, newCredentials('shop-buy'));
    await fundAccount(page, '$250');

    await page.goto('/marketplace');
    const booster = page.locator('article').filter({ hasText: 'Payout booster +5%' });
    await booster.getByRole('button', { name: '$5.00' }).click();
    await expect(page.getByText('added to your inventory')).toBeVisible();

    // it waits in the inventory until it is started
    const owned = page.getByRole('listitem').filter({ hasText: 'Payout booster +5%' });
    await expect(owned.getByRole('button', { name: 'Start it' })).toBeVisible();
    await owned.getByRole('button', { name: 'Start it' }).click();
    await expect(page.getByText('started')).toBeVisible();
    await expect(page.getByText('running')).toBeVisible();

    // the ticket now quotes five points more, and says why. An OTC market, so
    // the spec does not depend on the day of the week.
    await page.goto('/trade');
    await openMarket(page, 'EURUSD_OTC', 'EUR/USD (OTC)');
    const ticket = page.getByRole('region', { name: 'Order ticket' });
    await expect(ticket.getByText(/\+5% .* bonus|booster/i).first()).toBeVisible({ timeout: 15_000 });
  });

  test('refuses to buy what the balance cannot cover', async ({ page }) => {
    await register(page, newCredentials('shop-poor'));
    await page.goto('/marketplace');
    // a practice-only account has no live balance, so nothing priced in money is offered
    await expect(page.getByRole('button', { name: '$5.00' })).toBeDisabled();
  });
});
