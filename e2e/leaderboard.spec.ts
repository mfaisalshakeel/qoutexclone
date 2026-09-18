import { expect, test } from '@playwright/test';
import { expectNoHorizontalScroll, failOnPageErrors, fundAccount, placeTrade, register } from './helpers';

test.describe('top traders today', () => {
  test('a settled live position reaches the board, and a trader can leave it', async ({ page }) => {
    const errors = failOnPageErrors(page);
    const credentials = await register(page);

    // the board counts live money only, so the position has to be a funded one
    await fundAccount(page, '$250');
    await page.goto('/trade');
    await page.waitForSelector('canvas');
    await page
      .getByRole('button', { name: /Practice/ })
      .first()
      .click();
    await page.getByRole('button', { name: /Live account/ }).click();

    await placeTrade(page, 'Higher', '30s');
    const positions = page.getByRole('region', { name: 'Positions' });
    await positions.getByRole('tab', { name: /Closed/ }).click();
    // 30 seconds to expiry, plus the sweeper's next pass
    await expect(positions.getByRole('button', { name: /Details for the UP trade/ })).toBeVisible({
      timeout: 60_000,
    });

    await page.goto('/leaderboard');
    await expect(page.getByRole('heading', { name: 'Top traders today' })).toBeVisible();
    const optOut = page.getByLabel(/Keep me off the leaderboard/);

    // opting out takes effect at once rather than at the next refresh, which is
    // what makes this deterministic in both directions
    await optOut.check();
    await expect(page.getByText('You are off the leaderboard')).toBeVisible();
    await expect(page.getByRole('listitem').filter({ hasText: 'You' })).toHaveCount(0);

    await optOut.uncheck();
    await expect(page.getByText('You are on the leaderboard')).toBeVisible();
    const mine = page.getByRole('listitem').filter({ hasText: 'You' });
    await expect(mine).toHaveCount(1);
    // the row says what it is made of, and never carries a real name
    await expect(mine).toContainText(/1 position · \d+% won/);
    await expect(mine).not.toContainText(credentials.name);

    await expectNoHorizontalScroll(page);
    expect(errors).toEqual([]);
  });

  test('reads on a phone, and says so when a trader has settled nothing', async ({ page }) => {
    const errors = failOnPageErrors(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await register(page);

    await page.goto('/leaderboard');
    await expect(page.getByRole('heading', { name: 'Top traders today' })).toBeVisible();
    // a brand-new account has settled nothing, so it is not on the board
    await expect(page.getByRole('listitem').filter({ hasText: 'You' })).toHaveCount(0);
    await expect(page.getByLabel(/Keep me off the leaderboard/)).toBeVisible();

    await expectNoHorizontalScroll(page);
    expect(errors).toEqual([]);
  });
});
