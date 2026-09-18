import { expect, test, type Page } from '@playwright/test';
import { ADMIN, TRADER, failOnPageErrors, login } from './helpers';

/** Removes any rule this suite created before, however a run ended. */
async function clearRules(page: Page): Promise<void> {
  for (let guard = 0; guard < 10; guard += 1) {
    const row = page.getByRole('row', { name: /E2E / }).first();
    if ((await row.count()) === 0) break;
    const remove = row.getByRole('button', { name: 'Delete' });
    if ((await remove.count()) === 0) break;
    await remove.click();
    await row.getByRole('button', { name: 'Confirm delete' }).click();
    await expect(row)
      .toHaveCount(0, { timeout: 15_000 })
      .catch(() => undefined);
  }
}

test.describe('payout rules', () => {
  test('an admin rule changes what the terminal quotes, and the ticket says why', async ({ browser }) => {
    // two contexts rather than one: the operator and the trader are different
    // sessions, and this is what the feature actually has to do
    const adminContext = await browser.newContext();
    const traderContext = await browser.newContext();
    const admin = await adminContext.newPage();
    const trader = await traderContext.newPage();
    const adminErrors = failOnPageErrors(admin);
    const traderErrors = failOnPageErrors(trader);

    try {
      await login(admin, ADMIN);
      await admin.goto('/admin/payouts');
      await expect(admin.getByRole('heading', { name: 'Payouts' })).toBeVisible();

      // a previous run that was interrupted may have left one behind; this spec
      // asserts on counts, so it starts from a known state rather than assuming
      // the database is pristine
      await clearRules(admin);

      await login(trader, TRADER);
      const ticket = trader.getByRole('region', { name: 'Order ticket' });
      const figure = ticket.getByText(/^\d+%$/).first();
      await expect(figure).toBeVisible({ timeout: 15_000 });

      await admin.getByRole('button', { name: 'New rule' }).click();
      await admin.getByLabel('Name').fill('E2E all-day cut');
      await admin.getByLabel('Kind').selectOption('TIME_OF_DAY');
      await admin.getByLabel('Adjustment (points)').fill('-11');
      // a window covering the whole day, so it fires whenever this runs
      const window = admin.getByRole('group', { name: 'Daily window (UTC)' });
      await window.getByLabel('From').fill('00:00');
      await window.getByLabel('To').fill('00:00');

      // the preview answers before anything is saved
      await admin.getByRole('button', { name: 'Preview now' }).click();
      await expect(admin.getByText(/right now \(base/)).toBeVisible();

      await admin.getByRole('button', { name: 'Create rule' }).click();

      // the rules table, not the "markets paying something else" table below it
      const ruleRow = admin.getByRole('row', { name: /E2E all-day cut/ }).first();
      await expect(ruleRow).toBeVisible();
      await expect(ruleRow.getByText('-11 pts')).toBeVisible();
      await expect(admin.getByRole('heading', { name: /Markets paying something other/ })).toContainText(
        '(89)',
      );

      // the trader sees what moved the payout, without a reload
      await expect(ticket.getByText(/E2E all-day cut/)).toBeVisible({ timeout: 20_000 });

      // and the figure is exactly the base less this rule's eleven points
      const reason = await ticket.getByText(/% base/).innerText();
      const base = Number(reason.match(/(\d+)% base/)?.[1]);
      const shown = Number((await figure.innerText()).replace('%', ''));
      expect(base - shown).toBe(11);

      // removing it restores the base payout
      const row = admin.getByRole('row', { name: /E2E all-day cut/ }).first();
      await row.getByRole('button', { name: 'Delete' }).click();
      await row.getByRole('button', { name: 'Confirm delete' }).click();
      await expect(admin.getByRole('row', { name: /E2E all-day cut/ })).toHaveCount(0);
      await expect(admin.getByText('Every market is paying its base payout right now.')).toBeVisible();

      expect(adminErrors).toEqual([]);
      expect(traderErrors).toEqual([]);
    } finally {
      await adminContext.close();
      await traderContext.close();
    }
  });

  test('refuses a volatility rule with no threshold', async ({ page }) => {
    // the refusal is the point of this spec, so its 400 is not a fault
    const errors = failOnPageErrors(page, [/status of 400/]);
    await login(page, ADMIN);
    await page.goto('/admin/payouts');

    await page.getByRole('button', { name: 'New rule' }).click();
    await page.getByLabel('Name').fill('E2E unbounded');
    await page.getByLabel('Kind').selectOption('VOLATILITY');
    await page.getByLabel('Moving more than (×)').fill('');
    await page.getByLabel('Moving less than (×)').fill('');
    await page.getByRole('button', { name: 'Create rule' }).click();

    // the server refuses it and the rule never appears
    await expect(page.getByText(/always fire/i)).toBeVisible();
    await expect(page.getByRole('row', { name: /E2E unbounded/ })).toHaveCount(0);

    expect(errors).toEqual([]);
  });
});
