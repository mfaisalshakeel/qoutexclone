import { expect, test } from '@playwright/test';
import { TRADER, failOnPageErrors, login } from './helpers';

test.describe('chart layouts', () => {
  test('splits into panes, trades from the focused one, and follows the account', async ({ page }) => {
    const errors = failOnPageErrors(page);
    await login(page, TRADER);
    await page.waitForSelector('canvas');

    // start from a known layout rather than whatever the account last held
    const layoutGroup = page.getByRole('group', { name: 'Chart layout' });
    await layoutGroup.getByRole('button', { name: 'Single' }).click();
    await expect(layoutGroup.getByRole('button', { name: 'Single' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByLabel('Timeframe for pane 1')).toHaveCount(0);

    // four charts, each with its own market and timeframe
    await layoutGroup.getByRole('button', { name: 'Four' }).click();
    await expect(page.getByLabel('Timeframe for pane 1')).toBeVisible();
    await expect(page.getByLabel('Timeframe for pane 4')).toBeVisible();

    // the first pane trades; the others say nothing until focused
    await expect(page.getByText('trading')).toHaveCount(1);

    // a pane's timeframe is its own
    await page.getByLabel('Timeframe for pane 2').selectOption('5m');
    await expect(page.getByLabel('Timeframe for pane 2')).toHaveValue('5m');
    await expect(page.getByLabel('Timeframe for pane 1')).not.toHaveValue('5m');

    // focusing a pane moves the ticket to it
    const ticket = page.getByRole('region', { name: 'Order ticket' });
    await page
      .getByRole('button', { name: /^Trade from / })
      .first()
      .click();
    await expect(page.getByText('trading')).toHaveCount(1);
    await expect(ticket).toBeVisible();

    // the layout is on the account, so it survives a reload
    await page.reload();
    await page.waitForSelector('canvas');
    await expect(page.getByLabel('Timeframe for pane 4')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByLabel('Timeframe for pane 2')).toHaveValue('5m');

    // and back to one chart, which keeps the first pane as it was
    await page.getByRole('group', { name: 'Chart layout' }).getByRole('button', { name: 'Single' }).click();
    await expect(page.getByLabel('Timeframe for pane 1')).toHaveCount(0);
    await expect(page.locator('canvas').first()).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('every pane gets live candles, not just the last one to mount', async ({ page }) => {
    const errors = failOnPageErrors(page);

    // the socket has to carry one subscription per chart; with a single
    // subscription the last pane to mount would be the only live one. The
    // listener goes on before anything opens a socket.
    const channels: number[] = [];
    page.on('websocket', (socket) => {
      socket.on('framesent', (frame) => {
        try {
          const payload = JSON.parse(String(frame.payload));
          if (payload.type === 'subscribe' && Array.isArray(payload.channels)) {
            channels.push(payload.channels.length);
          }
        } catch {
          /* not a JSON frame */
        }
      });
    });

    await login(page, TRADER);
    await page.waitForSelector('canvas');
    await page.getByRole('group', { name: 'Chart layout' }).getByRole('button', { name: 'Single' }).click();

    await page
      .getByRole('group', { name: 'Chart layout' })
      .getByRole('button', { name: 'Side by side' })
      .click();
    await expect(page.getByLabel('Timeframe for pane 2')).toBeVisible();
    await page.getByLabel('Timeframe for pane 2').selectOption('15s');

    await expect.poll(() => Math.max(0, ...channels), { timeout: 15_000 }).toBeGreaterThan(1);

    // leave the account on a single chart for the next spec
    await page.getByRole('group', { name: 'Chart layout' }).getByRole('button', { name: 'Single' }).click();
    await expect(page.getByLabel('Timeframe for pane 1')).toHaveCount(0);

    expect(errors).toEqual([]);
  });
});
