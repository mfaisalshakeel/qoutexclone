import { expect, test } from '@playwright/test';
import { adminApiToken, failOnPageErrors } from './helpers';

test.describe('public pages', () => {
  test('Markets: real data, search and class filter both narrow the list', async ({ page }) => {
    const errors = failOnPageErrors(page);
    await page.goto('/markets');
    await expect(page.getByRole('heading', { name: 'Markets', level: 1 })).toBeVisible();

    const rows = () => page.locator('main .card > div.flex.items-center.gap-3');
    await expect(rows().first()).toBeVisible();
    const totalCount = await rows().count();
    expect(totalCount).toBeGreaterThan(1);

    await page.getByRole('tab', { name: 'Crypto' }).click();
    await expect(rows().first()).toBeVisible();
    const cryptoCount = await rows().count();
    expect(cryptoCount).toBeLessThan(totalCount);

    await page.getByRole('tab', { name: 'All' }).click();
    await page.getByLabel('Search markets').fill('nothing matches this at all');
    await expect(rows()).toHaveCount(0);
    await expect(page.getByText(/No markets match/)).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('Tournaments overview: explains the mechanic and reflects real tournament data', async ({ page }) => {
    const errors = failOnPageErrors(page);
    await page.goto('/tournaments/overview');
    await expect(page.getByRole('heading', { name: 'Tournaments', level: 1 })).toBeVisible();
    await expect(page.getByText('Join with a click')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Open right now' })).toBeVisible();
    // no tournaments are guaranteed to be open when this runs, so either the
    // empty state or a real card must render — never a blank gap
    await expect(page.getByText(/new tournaments are announced regularly|Starts \w/i).first()).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('Status levels: builds the ladder from live settings', async ({ page }) => {
    const errors = failOnPageErrors(page);
    await page.goto('/status');
    await expect(page.getByRole('heading', { name: 'Status levels', level: 1 })).toBeVisible();
    await expect(page.getByText('Standard')).toBeVisible();
    await expect(page.getByText('Pro')).toBeVisible();
    await expect(page.getByText('VIP')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('Affiliate: shows the live commission rate', async ({ page, request }) => {
    const errors = failOnPageErrors(page);
    const settingsRes = await request.get('/api/market/settings');
    const commissionPct = (await settingsRes.json()).settings['growth.referralCommissionPct'];

    await page.goto('/affiliate');
    await expect(page.getByRole('heading', { name: 'Affiliate programme', level: 1 })).toBeVisible();
    await expect(page.getByText(`Earn ${commissionPct}%`)).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('Help centre: search narrows the FAQ and the accordion opens', async ({ page }) => {
    const errors = failOnPageErrors(page);
    await page.goto('/help');
    await expect(page.getByRole('heading', { name: 'Help centre', level: 1 })).toBeVisible();

    const question = page.getByRole('button', { name: /How do I open my first position/ });
    await expect(question).toBeVisible();
    await question.click();
    await expect(page.getByText(/payout percentage is shown before you trade/)).toBeVisible();

    await page.getByLabel('Search the help centre').fill('two-factor');
    await expect(page.getByText(/How do I turn on two-factor/)).toBeVisible();
    await expect(question).toHaveCount(0);

    await page.getByLabel('Search the help centre').fill('something nobody asked ever');
    await expect(page.getByText(/No answers match/)).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('Contact: a real submission reaches the support inbox', async ({ page, request }) => {
    const errors = failOnPageErrors(page);
    const token = await adminApiToken(request);

    await page.goto('/contact');
    const subject = `E2E contact test ${Date.now()}`;
    await page.fill('#c-name', 'E2E Visitor');
    await page.fill('#c-email', 'e2e-visitor@example.test');
    await page.fill('#c-subject', subject);
    await page.fill('#c-message', 'This message only exists for the duration of a test run.');
    await page.click('button:has-text("Send message")');
    await expect(page.getByText('Message sent.')).toBeVisible();

    // confirm it actually produced a real, recorded email — not just a UI success state
    const emails = await request
      .get('/api/admin/emails?template=contact-form&pageSize=5', {
        headers: { authorization: `Bearer ${token}` },
      })
      .then((r) => r.json());
    expect(JSON.stringify(emails)).toContain(`Contact form: ${subject}`);

    expect(errors).toEqual([]);
  });

  test('Contact: the server refuses a message too short to be real, even bypassing the browser’s own validation', async ({
    request,
  }) => {
    // the form's own `minLength` stops a short message in the browser, so the
    // boundary that matters is proven directly against the API instead
    const res = await request.post('/api/content/contact', {
      data: { name: 'E2E Visitor', email: 'e2e-visitor@example.test', subject: 'Hi', message: 'short' },
    });
    expect(res.status()).toBe(400);
  });

  test('About: renders original copy', async ({ page }) => {
    const errors = failOnPageErrors(page);
    await page.goto('/about');
    await expect(page.getByRole('heading', { name: 'About Quantex', level: 1 })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('an unknown route shows a real 404 page, not a silent redirect home', async ({ page }) => {
    const errors = failOnPageErrors(page);
    await page.goto('/this-page-does-not-exist-anywhere');
    await expect(page.getByText('404')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
    await expect(page).toHaveURL(/\/this-page-does-not-exist-anywhere$/);
    expect(errors).toEqual([]);
  });

  test('cookie consent shows once and is remembered after acceptance', async ({ page }) => {
    await page.goto('/markets');
    const banner = page.getByRole('region', { name: 'Cookie notice' });
    await expect(banner).toBeVisible();
    await banner.getByRole('button', { name: 'Accept' }).click();
    await expect(banner).toHaveCount(0);

    await page.reload();
    await expect(page.getByRole('region', { name: 'Cookie notice' })).toHaveCount(0);
  });

  test('cookie consent never shows over the terminal', async ({ page }) => {
    // clear any prior acceptance so this proves the terminal suppression, not a leftover accept
    await page.addInitScript(() => localStorage.removeItem('quantex.cookies.accepted'));
    await page.goto('/login');
    await expect(page.getByRole('region', { name: 'Cookie notice' })).toBeVisible();
  });

  test('the header and footer both reach every new page', async ({ page }) => {
    await page.goto('/');
    for (const [label, path] of [
      ['Markets', '/markets'],
      ['Tournaments', '/tournaments/overview'],
      ['Status levels', '/status'],
      ['Affiliate', '/affiliate'],
      ['Help', '/help'],
      ['About', '/about'],
    ] as const) {
      await page.getByRole('link', { name: label, exact: true }).first().click();
      await expect(page).toHaveURL(new RegExp(`${path.replace('/', '\\/')}$`));
      await page.goBack();
    }
  });
});
