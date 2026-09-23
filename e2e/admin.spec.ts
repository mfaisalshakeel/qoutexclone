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

  test('promo code list searches, filters and shows a redemptions drawer', async ({ page }) => {
    const errors = failOnPageErrors(page);
    await login(page, ADMIN);
    await page.goto('/admin/promos');

    const code = `E2ESEARCH${Date.now()}`;
    await page.fill('#p-code', code);
    await page.fill('#p-value', '15');
    await page.fill('#p-min', '0');
    await page.fill('#p-cap', '0');
    await page.click('button:has-text("Create")');
    await expect(page.getByText('Promo code created')).toBeVisible();

    // search narrows the list to just this code — wait for it to actually land
    // in the URL before touching another control, the same hazard the
    // tournament list's filter race turned out to be
    await page.getByPlaceholder('Search by code').fill(code);
    await expect(page).toHaveURL(/search=/);
    const row = page.getByRole('row', { name: new RegExp(code) }).first();
    await expect(row).toBeVisible();

    // the kind filter narrows it too: this one is a deposit-bonus code, not a fixed credit
    await page.getByText('Kind', { exact: true }).click();
    const fixedCreditOption = page.getByLabel('Fixed credit', { exact: true });
    await fixedCreditOption.click();
    await expect(fixedCreditOption).toBeChecked();
    await expect(row).toHaveCount(0);
    await page.getByText('Clear filters ✕').click();
    await expect(row).toBeVisible();
    // close the still-open filter dropdown, or it overlaps the row below it
    await page.getByText('Kind', { exact: true }).click();

    // clicking the row opens its redemptions, empty until someone uses the code
    await row.getByText(code).click();
    await expect(page.getByText('No redemptions match')).toBeVisible();
    await page.getByRole('button', { name: 'Close ✕' }).click();

    expect(errors).toEqual([]);
  });

  test('markets list searches, filters by class and sorts by payout', async ({ page }) => {
    const errors = failOnPageErrors(page);
    await login(page, ADMIN);
    await page.goto('/admin/assets');

    // search narrows the list to the one currency pair used across this suite
    await page.getByPlaceholder('Search symbol or name').fill('EURUSD_OTC');
    await expect(page).toHaveURL(/search=/);
    const row = page.getByRole('row', { name: /EUR\/USD/ }).first();
    await expect(row).toBeVisible();

    // the class filter narrows it too: EUR/USD is a currency pair, not crypto
    await page.getByText('Class', { exact: true }).click();
    const cryptoOption = page.getByLabel('Crypto', { exact: true });
    await cryptoOption.click();
    await expect(cryptoOption).toBeChecked();
    await expect(row).toHaveCount(0);
    await page.getByText('Clear filters ✕').click();
    await expect(row).toBeVisible();
    // close the still-open filter dropdown, or it overlaps the row below it
    await page.getByText('Class', { exact: true }).click();

    // clicking the sortable Payout header reorders the list without erroring
    await page.getByRole('columnheader', { name: 'Payout' }).getByRole('button').click();
    await expect(page).toHaveURL(/sort=payoutPct/);
    await expect(page.getByRole('table')).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('audit log searches and filters by target', async ({ page }) => {
    const errors = failOnPageErrors(page);
    await login(page, ADMIN);

    // creating a promo code writes an audit row whose detail is the code
    // itself, a unique marker to find in the audit log below
    const code = `E2EAUDIT${Date.now()}`;
    await page.goto('/admin/promos');
    await page.fill('#p-code', code);
    await page.fill('#p-value', '10');
    await page.fill('#p-min', '0');
    await page.fill('#p-cap', '0');
    await page.click('button:has-text("Create")');
    await expect(page.getByText('Promo code created')).toBeVisible();

    await page.goto('/admin/audit');
    await page.getByPlaceholder('Search action, target or admin').fill(code);
    await expect(page).toHaveURL(/search=/);
    const row = page.getByRole('row', { name: new RegExp(code) }).first();
    await expect(row).toBeVisible();
    await expect(row).toContainText('promo.create');

    // the target filter narrows it too: this row's target is a promo, not a user
    const targetFilter = page.locator('summary').filter({ hasText: 'Target' });
    await targetFilter.click();
    const userOption = page.getByLabel('user', { exact: true });
    await userOption.click();
    await expect(userOption).toBeChecked();
    await expect(row).toHaveCount(0);
    await page.getByText('Clear filters ✕').click();
    await expect(row).toBeVisible();

    // the sortable When header reorders the list without erroring
    await page.getByRole('columnheader', { name: 'When' }).getByRole('button').click();
    await expect(page).toHaveURL(/sort=/);
    await expect(page.getByRole('table')).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('withdrawals queue searches, filters and orders the pending queue by trader status', async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const standardContext = await browser.newContext();
    const proContext = await browser.newContext();
    const standard = await standardContext.newPage();
    const pro = await proContext.newPage();
    const standardErrors = failOnPageErrors(standard);
    const proErrors = failOnPageErrors(pro);

    // a standard-level trader, funded and withdrawing first
    const standardCreds = await register(standard, newCredentials('wq-standard'));
    await fundAccount(standard, '$250');
    await standard.goto('/wallet?tab=withdraw');
    await standard.locator('button:has-text("Tether (TRC-20)")').first().click();
    await standard.fill('#withdraw-address', 'TJRyWwFs9wTFGZg3JbrVriFbNfCug5tDeC');
    await standard.fill('#withdraw-amount', '40');
    await expect(standard.getByText('You receive')).toBeVisible();
    await standard.click('button:has-text("Request withdrawal")');
    await expect(standard.getByText('In progress')).toBeVisible();

    // a Pro-level trader (crosses the $1,000 lifetime-deposit threshold via a
    // custom deposit amount, since the deposit panel's presets top out at
    // $500), funded and withdrawing second — later, but higher priority
    const proCreds = await register(pro, newCredentials('wq-pro'));
    await pro.goto('/wallet');
    await pro.locator('button:has-text("Tether (TRC-20)")').first().click();
    await pro.fill('#deposit-amount', '1200');
    await pro.click('button:has-text("Get deposit address")');
    await expect(pro.getByText('Awaiting deposit')).toBeVisible();
    await pro.click('text=Simulate the incoming payment');
    await expect(pro.getByText('Deposit credited')).toBeVisible({ timeout: 120_000 });

    await pro.goto('/wallet?tab=withdraw');
    await pro.locator('button:has-text("Tether (TRC-20)")').first().click();
    await pro.fill('#withdraw-address', 'TJRyWwFs9wTFGZg3JbrVriFbNfCug5tDeC');
    await pro.fill('#withdraw-amount', '40');
    await expect(pro.getByText('You receive')).toBeVisible();
    await pro.click('button:has-text("Request withdrawal")');
    await expect(pro.getByText('In progress')).toBeVisible();

    const adminContext = await browser.newContext();
    const admin = await adminContext.newPage();
    const errors = failOnPageErrors(admin);
    await login(admin, ADMIN);
    await admin.goto('/admin/withdrawals');

    // search narrows the list to just the standard trader's withdrawal
    await admin.getByPlaceholder('Search trader, address or tx hash').fill(standardCreds.email);
    await expect(admin).toHaveURL(/search=/);
    const standardRow = admin.locator('tr').filter({ hasText: standardCreds.email });
    await expect(standardRow).toBeVisible();
    await admin.getByPlaceholder('Search trader, address or tx hash').fill('');
    await expect(admin.locator('tr').filter({ hasText: proCreds.email })).toHaveCount(0);

    // filtering to PENDING puts the Pro trader ahead of the Standard trader,
    // even though the Standard trader asked first — priority, not recency
    await admin.locator('summary').filter({ hasText: 'Status' }).click();
    const pendingOption = admin.getByLabel('Pending', { exact: true });
    await pendingOption.click();
    await expect(pendingOption).toBeChecked();
    await expect(admin.locator('tr').filter({ hasText: proCreds.email })).toContainText('Pro');

    const rowTexts = await admin.locator('tbody tr').allInnerTexts();
    const proIndex = rowTexts.findIndex((t) => t.includes(proCreds.email));
    const standardIndex = rowTexts.findIndex((t) => t.includes(standardCreds.email));
    expect(proIndex).toBeGreaterThanOrEqual(0);
    expect(standardIndex).toBeGreaterThanOrEqual(0);
    expect(proIndex).toBeLessThan(standardIndex);

    // clean up: approve both so no live pending withdrawal is left behind
    await admin.getByText('Clear filters ✕').click();
    // close the still-open filter dropdown, or it overlaps the rows below it
    await admin.locator('summary').filter({ hasText: 'Status' }).click();
    for (const email of [proCreds.email, standardCreds.email]) {
      const row = admin.locator('tr').filter({ hasText: email });
      await row.locator('button:has-text("Approve")').click();
      await expect(admin.getByText('Payout sent').last()).toBeVisible();
      await expect(row.getByText('completed')).toBeVisible();
    }

    expect(errors).toEqual([]);
    expect(standardErrors).toEqual([]);
    expect(proErrors).toEqual([]);
    await standardContext.close();
    await proContext.close();
    await adminContext.close();
  });

  test('a trader cannot reach the back office', async ({ page }) => {
    await register(page, newCredentials('guard'));
    await page.goto('/admin');
    await page.waitForURL('**/trade');
    await expect(page.locator('canvas').first()).toBeVisible();
  });
});
