import { expect, test } from '@playwright/test';
import { TRADER, failOnPageErrors, login } from './helpers';

test.describe('asset picker', () => {
  test('filters by class, searches, sorts and stars a market', async ({ page }) => {
    const errors = failOnPageErrors(page);
    await login(page, TRADER);
    await page.waitForSelector('canvas');

    const rail = page.getByRole('complementary').filter({ has: page.getByLabel('Search markets') });
    const classes = rail.getByRole('tablist', { name: 'Market classes' });

    // tabs cover the catalogue's classes
    await expect(classes.getByRole('tab', { name: 'All' })).toHaveAttribute('aria-selected', 'true');
    for (const label of ['Forex', 'Crypto', 'Commodities', 'Stocks', 'Indices']) {
      await expect(classes.getByRole('tab', { name: label })).toBeVisible();
    }

    // one class at a time
    await classes.getByRole('tab', { name: 'Crypto' }).click();
    await expect(rail.getByRole('button', { name: /BTC\/USDT/ }).first()).toBeVisible();
    await expect(rail.getByRole('button', { name: /EUR\/USD/ })).toHaveCount(0);

    // search narrows within the tab, and says so when nothing matches
    await rail.getByLabel('Search markets').fill('eur');
    await expect(rail.getByText(/No markets match/)).toBeVisible();
    await rail.getByLabel('Search markets').fill('');

    // sorting by payout puts the best first
    await rail.getByLabel('Sort markets').selectOption('payout');
    const payouts = await rail.locator('span.chip', { hasText: '%' }).allInnerTexts();
    const numbers = payouts.map((text) => Number(text.replace('%', ''))).filter(Number.isFinite);
    expect(numbers.length).toBeGreaterThan(1);
    expect(numbers[0]).toBeGreaterThanOrEqual(numbers[1]);

    // starring adds a favourites tab and keeps the market in it
    const star = rail.getByRole('button', { name: /^Star / }).first();
    const starred = (await star.getAttribute('aria-label'))!.replace('Star ', '');
    await star.click();
    await classes.getByRole('tab', { name: 'Favourites' }).click();
    // the pair carries regex metacharacters — "BTC/USDT (OTC)" — so match it literally
    await expect(rail.getByRole('button', { name: starred, exact: false }).first()).toBeVisible();

    // and it survives a reload, because it is the trader's own list
    await page.reload();
    await page.waitForSelector('canvas');
    await rail.getByRole('tab', { name: 'Favourites' }).click();
    await expect(rail.getByRole('button', { name: /Unstar/ }).first()).toBeVisible();

    // unstar to leave the browser as it was; the tab goes with the last star
    await rail
      .getByRole('button', { name: /^Unstar / })
      .first()
      .click();
    await expect(rail.getByRole('tab', { name: 'Favourites' })).toHaveCount(0);

    expect(errors).toEqual([]);
  });

  test('keeps the markets just visited as tabs above the chart', async ({ page }) => {
    const errors = failOnPageErrors(page);
    await login(page, TRADER);
    await page.waitForSelector('canvas');

    const rail = page.getByRole('complementary').filter({ has: page.getByLabel('Search markets') });
    // the row is searched by symbol but reads as its display pair
    const visit = async (symbol: string, pair: RegExp) => {
      await rail.getByLabel('Search markets').fill(symbol);
      await rail.getByRole('button', { name: pair }).first().click();
      await rail.getByLabel('Search markets').fill('');
    };

    await visit('BTCUSDT', /BTC\/USDT/);
    await visit('XAUUSD', /XAU\/USD/);

    const recents = page.getByRole('tablist', { name: 'Recent markets' });
    await expect(recents).toBeVisible();
    await expect(recents.getByRole('tab', { name: /XAU\/USD/ })).toHaveAttribute('aria-selected', 'true');

    // going back is one click, and re-visiting promotes rather than duplicates
    await recents.getByRole('tab', { name: /BTC\/USDT/ }).click();
    await expect(recents.getByRole('tab', { name: /BTC\/USDT/ })).toHaveAttribute('aria-selected', 'true');
    await expect(recents.getByRole('tab', { name: /BTC\/USDT/ })).toHaveCount(1);

    expect(errors).toEqual([]);
  });
});
