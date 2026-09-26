import { expect, test } from '@playwright/test';
import { failOnPageErrors } from './helpers';

test.describe('public homepage', () => {
  test('renders every section with real data and links to a legal page', async ({ page }) => {
    const errors = failOnPageErrors(page, [/CERT_AUTHORITY/, /favicon/]);
    await page.goto('/');

    // hero: real CMS copy plus a live chart, not a placeholder
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByText('BTC/USDT · live')).toBeVisible();
    await expect(page.locator('svg[aria-label="Live BTCUSDT chart"]')).toBeVisible();

    // live markets strip: real assets with a real payout, not the loading skeleton
    await expect(page.getByText('Live markets, live payouts')).toBeVisible();
    const marketRows = page.getByRole('list', { name: 'Live markets' }).getByRole('listitem');
    await expect(marketRows.first().getByText(/^\d+%$/)).toBeVisible();

    // sections that come straight from the content CMS
    await expect(page.getByRole('heading', { name: 'Three steps, start to finish' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'One terminal, every screen' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Built for traders who watch the clock' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'The more you trade, the more you keep' })).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Trade the leaderboard, not just the market' }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Deposit your way' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Trade with your eyes open' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'What traders say' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Questions, answered' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Your first trade is on the house' })).toBeVisible();

    // testimonials: seeded, real quotes with a name and a role
    await expect(page.getByText('Amara O.')).toBeVisible();

    // the FAQ accordion actually opens and closes
    const question = page.getByRole('button', { name: /How do I open my first position/ });
    await expect(question).toBeVisible();
    await question.click();
    await expect(page.getByText(/payout percentage is shown before you trade/)).toBeVisible();
    await question.click();
    await expect(page.getByText(/payout percentage is shown before you trade/)).toHaveCount(0);

    // footer: risk warning and a real legal link
    await expect(page.getByText(/you can lose the money/i)).toBeVisible();
    await page.getByRole('link', { name: 'Terms of Service' }).click();
    await expect(page).toHaveURL(/\/legal\/terms$/);
    await expect(page.getByRole('heading', { name: 'Terms of Service', level: 1 })).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('the final CTA and header both lead into registration', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Create free account' }).first().click();
    await expect(page).toHaveURL(/\/register$/);
  });

  test('a legal page that has never been published shows a clear not-found state, not a crash', async ({
    page,
  }) => {
    // the 404 itself is the expected, handled response this test is proving —
    // not a fault to fail on
    const errors = failOnPageErrors(page, [/CERT_AUTHORITY/, /favicon/, /404 \(Not Found\)/]);
    await page.goto('/legal/not-a-real-page');
    await expect(page.getByText('This page has not been published yet.')).toBeVisible();
    expect(errors).toEqual([]);
  });
});
