import { expect, test } from '@playwright/test';
import {
  expectNoHorizontalScroll,
  failOnPageErrors,
  fundAccount,
  placeTrade,
  register,
  useLiveAccount,
} from './helpers';

test.describe('notification centre', () => {
  test('collects a deposit and a settled position, and clears when read', async ({ page }) => {
    const errors = failOnPageErrors(page);
    await register(page);

    // a credited deposit is the first thing worth telling a trader about
    await fundAccount(page, '$250');
    const bell = page.getByRole('button', { name: /^Notifications/ });
    await expect(bell).toHaveAttribute('aria-label', /1 unread/, { timeout: 20_000 });

    // and a settled live position is the second
    await page.goto('/trade');
    await page.waitForSelector('canvas');
    await useLiveAccount(page);
    await placeTrade(page, 'Higher', '30s');
    await expect(bell).toHaveAttribute('aria-label', /2 unread/, { timeout: 90_000 });

    await bell.click();
    const panel = page.getByRole('dialog', { name: 'Notifications' });
    await expect(panel.getByText('Deposit credited')).toBeVisible();
    await expect(panel.getByText(/(won|lost|refunded)/).first()).toBeVisible();

    // reading one takes the trader to where it happened
    await panel.getByText('Deposit credited').click();
    await expect(page).toHaveURL(/\/wallet/);
    await expect(bell).toHaveAttribute('aria-label', /1 unread/);

    // and reading the rest empties the badge for good
    await bell.click();
    await panel.getByRole('button', { name: 'Mark all read' }).click();
    await expect(bell).toHaveAttribute('aria-label', 'Notifications');
    await page.reload();
    await expect(bell).toHaveAttribute('aria-label', 'Notifications');

    // the history is still there once read
    await bell.click();
    await expect(panel.getByRole('list', { name: 'Recent notifications' })).toBeVisible();
    await expect(panel.getByText('Deposit credited')).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('says when there is nothing, and remembers the sound choice per device', async ({ page }) => {
    const errors = failOnPageErrors(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await register(page);

    const bell = page.getByRole('button', { name: /^Notifications/ });
    await expect(bell).toHaveAttribute('aria-label', 'Notifications');
    await bell.click();

    const panel = page.getByRole('dialog', { name: 'Notifications' });
    await expect(panel.getByText(/Nothing yet/)).toBeVisible();
    await expectNoHorizontalScroll(page);

    // sound is a per-device preference, so it lives in the browser
    await panel.getByRole('button', { name: 'Sound on' }).click();
    await expect(panel.getByRole('button', { name: 'Sound off' })).toBeVisible();
    await page.reload();
    await bell.click();
    await expect(panel.getByRole('button', { name: 'Sound off' })).toBeVisible();

    // desktop alerts stay off until the browser grants permission
    await expect(panel.getByRole('button', { name: /Desktop alerts off/ })).toBeVisible();

    // Escape closes it, as a dialog should
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);

    expect(errors).toEqual([]);
  });
});
