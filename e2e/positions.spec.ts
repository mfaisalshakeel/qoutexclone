import { expect, test } from '@playwright/test';
import { TRADER, failOnPageErrors, login } from './helpers';

test.describe('positions panel', () => {
  test('shows progress while open, then a detail view with the chart snippet', async ({ page }) => {
    const errors = failOnPageErrors(page);
    await login(page, TRADER);
    await page.waitForSelector('canvas');

    const ticket = page.getByRole('region', { name: 'Order ticket' });
    const panel = page.getByRole('region', { name: 'Positions' });

    // a five-second position, so the test can watch it settle
    await ticket
      .getByRole('group', { name: 'Expiry' })
      .getByRole('button', { name: '5s', exact: true })
      .click();
    await ticket
      .getByRole('group', { name: 'Investment' })
      .getByRole('button', { name: '10', exact: true })
      .click();
    await ticket.getByRole('button', { name: /Higher/ }).click();

    // while it is open, the bar says how far through its life it is
    const progress = panel.getByRole('progressbar').first();
    await expect(progress).toBeVisible({ timeout: 15_000 });
    const started = Number(await progress.getAttribute('aria-valuenow'));
    expect(started).toBeGreaterThanOrEqual(0);
    await expect
      .poll(async () => Number(await progress.getAttribute('aria-valuenow')), { timeout: 10_000 })
      .toBeGreaterThan(started);

    // once it settles it moves to Closed, where its row opens the detail view
    await panel.getByRole('tab', { name: 'Closed' }).click();
    const row = panel.getByRole('button', { name: /^Details for the / }).first();
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.click();

    const dialog = page.getByRole('dialog', { name: /trade$/ });
    await expect(dialog).toBeVisible();
    // the snippet is a real chart of the trade's own window
    await expect(dialog.getByRole('img', { name: /from .* to / })).toBeVisible({ timeout: 15_000 });
    await expect(dialog.getByText('Stake')).toBeVisible();
    await expect(dialog.getByText('Entry')).toBeVisible();
    await expect(dialog.getByText(/^(Won|Lost|Refunded)$/)).toBeVisible();

    // and it can be traded again from there
    await dialog.getByRole('button', { name: 'Trade again' }).click();
    await expect(page.getByText(/Repeated/)).toBeVisible({ timeout: 15_000 });
    await expect(dialog).toBeHidden();

    expect(errors).toEqual([]);
  });

  test('closes the detail view with Escape', async ({ page }) => {
    const errors = failOnPageErrors(page);
    await login(page, TRADER);
    await page.waitForSelector('canvas');

    const panel = page.getByRole('region', { name: 'Positions' });
    await panel.getByRole('tab', { name: 'Closed' }).click();

    const row = panel.getByRole('button', { name: /^Details for the / }).first();
    await expect(row).toBeVisible({ timeout: 20_000 });
    await row.click();

    const dialog = page.getByRole('dialog', { name: /trade$/ });
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    expect(errors).toEqual([]);
  });
});
