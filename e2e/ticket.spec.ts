import { expect, test } from '@playwright/test';
import { TRADER, failOnPageErrors, login } from './helpers';

test.describe('ticket', () => {
  test('steps, presets and balance shares all stay inside the market range', async ({ page }) => {
    const errors = failOnPageErrors(page);
    await login(page, TRADER);
    await page.waitForSelector('canvas');

    const ticket = page.getByRole('complementary').filter({ hasText: 'Payout' }).first();
    const investment = ticket.getByRole('group', { name: 'Investment' });
    const amount = investment.getByLabel('Investment amount');

    // the market's own range is stated, so a trader knows what is allowed
    const range = await investment.getByText(/on this market$/).innerText();
    const [, min, max] = range.match(/\$([\d,.]+)–\$([\d,.]+)/) ?? [];
    const minValue = Number(min.replace(/,/g, ''));
    const maxValue = Number(max.replace(/,/g, ''));
    expect(minValue).toBeGreaterThan(0);
    expect(maxValue).toBeGreaterThan(minValue);

    // a preset sets the stake exactly
    const preset = investment.getByRole('button', { name: '25', exact: true });
    await preset.click();
    await expect(amount).toHaveValue('25');
    await expect(preset).toHaveAttribute('aria-pressed', 'true');

    // the step buttons move by the configured amount and stop at the bounds
    const before = Number(await amount.inputValue());
    await investment.getByRole('button', { name: /Increase amount/ }).click();
    const after = Number(await amount.inputValue());
    expect(after).toBeGreaterThan(before);

    // typing past the maximum is pulled back into range when the field is left
    await amount.fill(String(maxValue * 10));
    await amount.blur();
    await expect(amount).toHaveValue(String(maxValue));

    // and below the minimum
    await amount.fill('0');
    await amount.blur();
    await expect(amount).toHaveValue(String(minValue));

    // a share of the balance lands inside the range too
    await investment.getByRole('button', { name: 'All' }).click();
    const all = Number(await amount.inputValue());
    expect(all).toBeGreaterThanOrEqual(minValue);
    expect(all).toBeLessThanOrEqual(maxValue);

    // the profit follows the stake and the live payout
    await investment.getByRole('button', { name: '25', exact: true }).click();
    const payout = Number(
      (
        await ticket
          .getByText(/^\d+%$/)
          .first()
          .innerText()
      ).replace('%', ''),
    );
    await expect(ticket.getByText(`$${((25 * payout) / 100).toFixed(2)}`)).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('repeats and doubles an open position', async ({ page }) => {
    const errors = failOnPageErrors(page);
    await login(page, TRADER);
    await page.waitForSelector('canvas');

    const ticket = page.getByRole('complementary').filter({ hasText: 'Payout' }).first();
    const panel = page.getByRole('complementary').filter({ hasText: 'Pending' }).first();

    // one position to repeat, on a one-minute expiry so it stays open
    await ticket
      .getByRole('group', { name: 'Expiry' })
      .getByRole('button', { name: '1m', exact: true })
      .click();
    await ticket
      .getByRole('group', { name: 'Investment' })
      .getByRole('button', { name: '10', exact: true })
      .click();
    await ticket.getByRole('button', { name: /Higher/ }).click();
    await expect(panel.getByRole('tab', { name: /Open \(/ })).toBeVisible({ timeout: 15_000 });

    const openTab = panel.getByRole('tab', { name: /Open \(/ });
    const countOf = async () => Number((await openTab.innerText()).match(/\((\d+)\)/)?.[1] ?? '0');
    const before = await countOf();
    expect(before).toBeGreaterThan(0);

    await panel.getByRole('button', { name: 'Repeat' }).first().click();
    await expect(page.getByText('Repeated')).toBeVisible({ timeout: 15_000 });
    await expect.poll(countOf).toBe(before + 1);

    await panel.getByRole('button', { name: 'Double up' }).first().click();
    await expect(page.getByText('Doubled up')).toBeVisible({ timeout: 15_000 });
    await expect.poll(countOf).toBe(before + 2);

    expect(errors).toEqual([]);
  });
});
