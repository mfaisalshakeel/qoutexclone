import { expect, test } from '@playwright/test';
import { ADMIN, failOnPageErrors, fundAccount, login, newCredentials, register } from './helpers';

test.describe('admin', () => {
  // this spec drives two complete journeys (fund, request, approve) back to back
  test.describe.configure({ timeout: 180_000 });

  test('approves a withdrawal end to end', async ({ browser }) => {
    const traderContext = await browser.newContext();
    const trader = await traderContext.newPage();
    const errors = failOnPageErrors(trader, [/CERT_AUTHORITY/, /favicon/]);

    // fund the account through the deposit flow, then request a payout
    const credentials = await register(trader, newCredentials('payout'));
    await fundAccount(trader, '$250');

    await trader.goto('/wallet?tab=withdraw');
    await trader.locator('button:has-text("Tether (TRC-20)")').first().click();
    await trader.fill('#withdraw-address', 'TJRyWwFs9wTFGZg3JbrVriFbNfCug5tDeC');
    await trader.fill('#withdraw-amount', '40');
    await expect(trader.getByText('You receive')).toBeVisible();
    await trader.click('button:has-text("Request withdrawal")');
    await expect(trader.getByText('In progress')).toBeVisible();

    const adminContext = await browser.newContext();
    const admin = await adminContext.newPage();
    await login(admin, ADMIN);
    await admin.goto('/admin/withdrawals');

    const row = admin.locator('tr').filter({ hasText: credentials.email });
    await expect(row).toBeVisible();
    await row.locator('button:has-text("Approve")').click();
    await expect(admin.getByText('Payout sent')).toBeVisible();
    await expect(row.getByText('completed')).toBeVisible();

    // the trader's held funds are consumed, not returned
    await trader.goto('/wallet?tab=history');
    await expect(trader.getByText('Withdrawal')).toBeVisible();

    expect(errors).toEqual([]);
    await traderContext.close();
    await adminContext.close();
  });

  test('approves one e-wallet withdrawal with a note and rejects another, reason and all', async ({
    browser,
  }) => {
    const traderContext = await browser.newContext();
    const trader = await traderContext.newPage();
    const errors = failOnPageErrors(trader, [/CERT_AUTHORITY/, /favicon/]);

    const credentials = await register(trader, newCredentials('ewallet-payout'));
    await fundAccount(trader, '$250');

    const requestEwalletWithdrawal = async (amount: string) => {
      await trader.goto('/wallet?tab=withdraw');
      await trader.locator('button:has-text("E-wallet (sandbox)")').first().click();
      await trader.fill('#withdraw-address', 'trader@example.test');
      await trader.fill('#withdraw-amount', amount);
      await expect(trader.getByText('You receive')).toBeVisible();
      await trader.click('button:has-text("Request withdrawal")');
      await expect(trader.getByText('Withdrawal requested')).toBeVisible();
    };

    await requestEwalletWithdrawal('40');
    await requestEwalletWithdrawal('30');

    const adminContext = await browser.newContext();
    const admin = await adminContext.newPage();
    await login(admin, ADMIN);
    await admin.goto('/admin/withdrawals');

    const byEmail = admin.locator('tr').filter({ hasText: credentials.email });
    await expect(byEmail).toHaveCount(2);
    // distinguished by amount, which stays stable as status changes underneath
    const approveRow = byEmail.filter({ hasText: '$40.00' });
    const rejectRow = byEmail.filter({ hasText: '$30.00' });

    await approveRow.getByPlaceholder('Note (required to reject)').fill('Verified and sent');
    await approveRow.locator('button:has-text("Approve")').click();
    await expect(admin.getByText('Payout sent')).toBeVisible();
    await expect(approveRow.getByText('completed')).toBeVisible();

    // rejecting without a note is refused client-side
    await rejectRow.locator('button:has-text("Reject")').click();
    await expect(admin.getByText('Add a note first')).toBeVisible();
    await expect(rejectRow.getByText('rejected')).toHaveCount(0);

    await rejectRow.getByPlaceholder('Note (required to reject)').fill('Could not verify the e-wallet handle');
    await rejectRow.locator('button:has-text("Reject")').click();
    await expect(admin.getByText('Withdrawal rejected, funds returned')).toBeVisible();
    await expect(rejectRow.getByText('rejected')).toBeVisible();

    // the trader sees both outcomes on their own timelines, reason included
    await trader.goto('/wallet?tab=withdraw');
    await expect(trader.getByText('Recently settled')).toBeVisible();
    await expect(trader.getByText('Completed').first()).toBeVisible();
    await expect(trader.getByText('Could not verify the e-wallet handle')).toBeVisible();

    expect(errors).toEqual([]);
    await traderContext.close();
    await adminContext.close();
  });

  test('dashboard period selector switches ranges and compares against the previous one', async ({
    page,
  }) => {
    const errors = failOnPageErrors(page);
    await login(page, ADMIN);
    await page.goto('/admin');

    await expect(page.getByText('New registrations')).toBeVisible();
    await expect(page.getByText('First-time depositors')).toBeVisible();
    await expect(page.getByText('Active traders')).toBeVisible();
    await expect(page.getByText('Average stake')).toBeVisible();
    await expect(page.getByText('Win rate')).toBeVisible();
    // "Today" is the default; a comparison badge sits beside a period KPI's label
    const depositCard = page.locator('.card', { hasText: 'Deposit volume' });
    await expect(depositCard.getByText(/▲|▼|flat|new/)).toBeVisible();
    // a snapshot tile (not a period flow) never grows a comparison badge
    const tradersCard = page.locator('.card', { hasText: 'Total traders' });
    await expect(tradersCard.getByText(/▲|▼|flat|new/)).toHaveCount(0);

    // switching the preset re-fetches without breaking the page
    await page.getByRole('button', { name: '30 days' }).click();
    await expect(page.getByText('New registrations')).toBeVisible();
    await expect(depositCard.getByText(/▲|▼|flat|new/)).toBeVisible();

    // a custom range reveals its own date inputs, hidden for every preset
    await expect(page.getByLabel('From')).toHaveCount(0);
    await page.getByRole('button', { name: 'Custom' }).click();
    await expect(page.getByLabel('From')).toBeVisible();
    await page.getByLabel('From').fill('2020-01-01');
    await page.getByLabel('To').fill('2020-01-31');
    await expect(page.getByText('New registrations')).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('dashboard charts render for every window and switch without breaking the page', async ({
    page,
  }) => {
    const errors = failOnPageErrors(page);
    await login(page, ADMIN);
    await page.goto('/admin');

    await expect(page.getByText('Deposits vs withdrawals')).toBeVisible();
    await expect(page.getByText('House P&L · last')).toBeVisible();
    await expect(page.getByText('Registrations → first deposit')).toBeVisible();
    await expect(page.getByText('Volume by asset class')).toBeVisible();
    await expect(page.getByText('Top 10 assets by volume')).toBeVisible();
    await expect(page.getByText('Live exposure per market')).toBeVisible();
    await expect(page.getByText('Hourly activity')).toBeVisible();

    // the chart window is independent of the KPI period picker above it
    await page.getByRole('button', { name: 'Last 7d' }).click();
    await expect(page.getByText('Deposits vs withdrawals · last 7 days')).toBeVisible();
    await page.getByRole('button', { name: 'Last 90d' }).click();
    await expect(page.getByText('Deposits vs withdrawals · last 90 days')).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('back office sections all load', async ({ page }) => {
    const errors = failOnPageErrors(page, [/CERT_AUTHORITY/, /favicon/]);
    await login(page, ADMIN);

    for (const [path, heading] of [
      ['/admin', 'Dashboard'],
      ['/admin/withdrawals', 'Withdrawals'],
      ['/admin/deposits', 'Deposits'],
      ['/admin/users', 'Traders'],
      ['/admin/kyc', 'Identity verification'],
      ['/admin/support', 'Support desk'],
      ['/admin/tournaments', 'Tournaments'],
      ['/admin/promos', 'Promo codes'],
      ['/admin/assets', 'Markets'],
      ['/admin/email', 'Email'],
      ['/admin/audit', 'Audit log'],
    ] as const) {
      await page.goto(path);
      await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
    }

    expect(errors).toEqual([]);
  });

  test('support desk searches and filters the ticket list', async ({ browser }) => {
    const traderContext = await browser.newContext();
    const trader = await traderContext.newPage();
    const traderErrors = failOnPageErrors(trader);
    const creds = await register(trader, newCredentials('support'));
    const marker = creds.email.split('@')[0];

    await trader.getByRole('button', { name: 'Support chat' }).click();
    await trader.getByPlaceholder('Subject (optional)').fill(`${marker} deposit question`);
    await trader.getByPlaceholder('Write a message…').fill('How long does a deposit take to confirm?');
    await trader.getByRole('button', { name: 'Send' }).click();
    await expect(trader.getByText(`${marker} deposit question`)).toBeVisible();

    await trader.getByRole('button', { name: 'New' }).click();
    await trader.getByPlaceholder('Subject (optional)').fill(`${marker} withdrawal question`);
    await trader.getByPlaceholder('Write a message…').fill('Why is my withdrawal still pending?');
    await trader.getByRole('button', { name: 'Send' }).click();
    await expect(trader.getByText(`${marker} withdrawal question`)).toBeVisible();
    expect(traderErrors).toEqual([]);
    await traderContext.close();

    const adminContext = await browser.newContext();
    const admin = await adminContext.newPage();
    const errors = failOnPageErrors(admin);
    await login(admin, ADMIN);
    await admin.goto('/admin/support');
    // the active thread's own header repeats the subject, so list-row matches
    // are not unique on the page — .first() is enough to prove the row is there
    await expect(admin.getByText(`${marker} deposit question`).first()).toBeVisible();
    await expect(admin.getByText(`${marker} withdrawal question`).first()).toBeVisible();

    // search narrows the list to the matching conversation only
    await admin.getByPlaceholder('Search subject or trader').fill(`${marker} deposit`);
    await expect(admin.getByText(`${marker} deposit question`).first()).toBeVisible();
    await expect(admin.getByText(`${marker} withdrawal question`)).toHaveCount(0);
    await admin.getByPlaceholder('Search subject or trader').fill('');
    await expect(admin.getByText(`${marker} withdrawal question`).first()).toBeVisible();

    // both new conversations are OPEN, so filtering to CLOSED hides them
    await admin.getByText('Status', { exact: true }).click();
    await admin.getByLabel('Closed', { exact: true }).click();
    await expect(admin.getByText(`${marker} deposit question`)).toHaveCount(0);
    await expect(admin.getByText(`${marker} withdrawal question`)).toHaveCount(0);
    await admin.getByText('Clear filters ✕').click();
    await expect(admin.getByText(`${marker} deposit question`).first()).toBeVisible();

    expect(errors).toEqual([]);
    await adminContext.close();
  });

  test('tournament list searches, filters and shows a leaderboard drawer', async ({ page }) => {
    const errors = failOnPageErrors(page);
    await login(page, ADMIN);
    await page.goto('/admin/tournaments');

    const name = `E2E Search Cup ${Date.now()}`;
    await page.fill('#t-name', name);
    await page.fill('#t-fee', '0');
    await page.fill('#t-pool', '0');
    await page.fill('#t-chips', '500');
    await page.fill('#t-split', '100');
    // starts a couple of hours out, so the background sweeper that promotes a
    // due tournament to RUNNING does not race this test's own SCHEDULED checks
    await page.fill('#t-start', new Date(Date.now() + 2 * 3600 * 1000).toISOString().slice(0, 16));
    await page.click('button:has-text("Create tournament")');
    await expect(page.getByText('Tournament created')).toBeVisible();

    // search narrows the list to just this tournament — wait for the debounced
    // search to actually land in the URL before touching another control, or a
    // quick second change can race the first and clobber it
    await page.getByPlaceholder('Search by name').fill(name);
    await expect(page).toHaveURL(/search=/);
    const row = page.getByRole('row', { name: new RegExp(name.replace(/\s/g, '\\s')) }).first();
    await expect(row).toBeVisible();

    // the status filter narrows it too: a fresh tournament is SCHEDULED, not RUNNING
    await page.getByText('Status', { exact: true }).click();
    const runningOption = page.getByLabel('Running', { exact: true });
    await runningOption.click();
    await expect(runningOption).toBeChecked();
    await expect(row).toHaveCount(0);
    await page.getByText('Clear filters ✕').click();
    await expect(row).toBeVisible();

    // clicking the row opens its leaderboard, empty until someone joins
    await row.getByText(name).click();
    await expect(page.getByText('No entrants match')).toBeVisible();
    await page.getByRole('button', { name: 'Close ✕' }).click();

    // clean up: start and finish it so it stops appearing as an open contest
    await row.getByRole('button', { name: 'Start' }).click();
    await expect(page.getByText('Tournament started')).toBeVisible();
    await row.getByRole('button', { name: 'Finish & pay' }).click();
    await row.getByRole('button', { name: 'Confirm payout' }).click();
    await expect(page.getByText('Prizes paid out')).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('a trader cannot reach the back office', async ({ page }) => {
    await register(page, newCredentials('guard'));
    await page.goto('/admin');
    await page.waitForURL('**/trade');
    await expect(page.locator('canvas').first()).toBeVisible();
  });
});
