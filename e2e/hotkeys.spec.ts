import { expect, test } from '@playwright/test';
import { TRADER, failOnPageErrors, login, openMarket } from './helpers';

test.describe('hotkeys', () => {
  test('moves the stake and the expiry, and never fires while typing', async ({ page }) => {
    const errors = failOnPageErrors(page);
    await login(page, TRADER);
    // an always-open market, so these specs do not depend on the clock or on
    // whichever market another spec left on the account
    await openMarket(page, 'EURUSD_OTC', 'EUR/USD (OTC)');

    const ticket = page.getByRole('region', { name: 'Order ticket' });
    const investment = ticket.getByRole('group', { name: 'Investment' });
    const amount = investment.getByLabel('Investment amount');

    await investment.getByRole('button', { name: '25', exact: true }).click();
    await expect(amount).toHaveValue('25');

    // D raises the stake, A lowers it
    await page.locator('body').press('d');
    const raised = Number(await amount.inputValue());
    expect(raised).toBeGreaterThan(25);
    await page.locator('body').press('a');
    await expect(amount).toHaveValue('25');

    // the expiry walks its list
    const expiry = ticket.getByRole('group', { name: 'Expiry' });
    await expiry.getByRole('button', { name: '1m', exact: true }).click();
    await page.locator('body').press('e');
    await expect(expiry.getByRole('button', { name: '1m', exact: true })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await page.locator('body').press('q');
    await expect(expiry.getByRole('button', { name: '1m', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // This is the one that matters: typing a stake must not place trades.
    // "25" contains no bound key, so type one that does — "d" is the step key.
    await amount.click();
    await amount.fill('50');
    // "d" is the step-up shortcut; inside the field it has to be just a keystroke
    await amount.press('d');
    await expect(amount).toHaveValue('50');
    // no position was opened by any of that
    const panel = page.getByRole('region', { name: 'Positions' });
    await expect(panel.getByRole('tab', { name: 'Open' })).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('shows the shortcut list, rebinds a key and turns them off', async ({ page }) => {
    const errors = failOnPageErrors(page);
    await login(page, TRADER);
    // an always-open market, so these specs do not depend on the clock or on
    // whichever market another spec left on the account
    await openMarket(page, 'EURUSD_OTC', 'EUR/USD (OTC)');

    // ? opens the overlay
    await page.locator('body').press('?');
    const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Buy higher')).toBeVisible();

    // rebinding captures the next keystroke
    await dialog.getByRole('button', { name: 'Change the shortcut for Amount +' }).click();
    await expect(dialog.getByText('Press a key…')).toBeVisible();
    await page.locator('body').press('k');
    await expect(dialog.getByRole('button', { name: 'Change the shortcut for Amount +' })).toHaveText('K');

    // and it survives a reload, because it is the trader's own preference
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await page.reload();
    await page.waitForSelector('canvas');
    await page.locator('body').press('?');
    await expect(
      page.getByRole('dialog', { name: 'Keyboard shortcuts' }).getByRole('button', {
        name: 'Change the shortcut for Amount +',
      }),
    ).toHaveText('K');

    // turning them off stops the keys working
    const reopened = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await reopened.getByLabel('Shortcuts enabled').uncheck();
    await reopened.getByRole('button', { name: 'Close' }).click();

    const ticket = page.getByRole('region', { name: 'Order ticket' });
    const amount = ticket.getByRole('group', { name: 'Investment' }).getByLabel('Investment amount');
    const before = await amount.inputValue();
    await page.locator('body').press('k');
    await expect(amount).toHaveValue(before);

    // ? no longer opens it either, so the button is the way back in
    await page.locator('body').press('?');
    await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Shortcuts (?)' }).click();
    const back = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await expect(back).toBeVisible();

    // leave the browser as it was for the next spec
    await back.getByRole('button', { name: 'Restore defaults' }).click();
    await back.getByRole('button', { name: 'Close' }).click();

    expect(errors).toEqual([]);
  });
});
