import { expect, request as apiRequest, type APIRequestContext, type Page } from '@playwright/test';
import { totp } from '../server/src/lib/totp.js';

// the seeded admin carries a fixed 2FA secret (server/src/seed.ts) since
// admin access requires a second factor; `login` completes the challenge
// automatically whenever credentials carry one, admin or not.
export const ADMIN = {
  email: 'admin@quotexclone.dev',
  password: 'Admin123!',
  twoFactorSecret: 'JBSWY3DPEHPK3PXP',
};
export const TRADER = { email: 'trader@quotexclone.dev', password: 'Trader123!' };

export interface Credentials {
  email: string;
  password: string;
  name: string;
}

/** A fresh account per spec run, so specs never fight over balances. */
export function newCredentials(prefix = 'e2e'): Credentials {
  return {
    email: `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.test`,
    password: 'Password123',
    name: 'E2E Trader',
  };
}

export async function register(page: Page, credentials = newCredentials()): Promise<Credentials> {
  await page.goto('/register');
  await page.fill('#name', credentials.name);
  await page.fill('#email', credentials.email);
  await page.fill('#password', credentials.password);
  await page.click('button[type=submit]');
  await page.waitForURL('**/trade');
  return credentials;
}

export async function login(
  page: Page,
  credentials: { email: string; password: string; twoFactorSecret?: string },
): Promise<void> {
  await page.goto('/login');
  await page.fill('#email', credentials.email);
  await page.fill('#password', credentials.password);
  await page.click('button[type=submit]');
  if (credentials.twoFactorSecret) {
    await page.getByRole('heading', { name: 'One more step' }).waitFor();
    await page.fill('#code', totp(credentials.twoFactorSecret));
    await page.getByRole('button', { name: 'Confirm' }).click();
  }
  await page.waitForURL('**/trade');
}

/**
 * The admin's access token straight from the API, for specs that arrange
 * state through requests rather than the browser. Completes the 2FA
 * challenge the same way `login` does, since the seeded admin always carries
 * one now.
 */
export async function adminApiToken(request: APIRequestContext): Promise<string> {
  const first = await request.post('/api/auth/login', { data: ADMIN });
  const body = await first.json();
  if (!body.twoFactorRequired) return body.accessToken;
  const second = await request.post('/api/auth/2fa', {
    data: { challengeToken: body.challengeToken, code: totp(ADMIN.twoFactorSecret) },
  });
  return (await second.json()).accessToken;
}

/**
 * From the admin traders list, searches for a trader and opens their full
 * profile page. Works at both the desktop (table rows) and mobile (stacked
 * cards, with their own "View details" button) layouts, since the caller
 * does not know which one is rendered.
 */
export async function openTraderProfile(page: Page, email: string): Promise<void> {
  await page.goto('/admin/users');
  await page.getByPlaceholder('Search name or email').fill(email);
  await expect(page).toHaveURL(/search=/);
  const pattern = new RegExp(email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const row = page.locator('tr:visible, li:visible').filter({ hasText: pattern }).first();
  const detailsButton = row.getByRole('button', { name: 'View details' });
  if (await detailsButton.isVisible().catch(() => false)) {
    await detailsButton.click();
  } else {
    await row.click();
  }
  await page.getByRole('link', { name: 'View full profile →' }).click();
  await page.waitForURL(/\/admin\/users\/.+/);
}

/**
 * Puts the terminal on a named market.
 *
 * The workspace is saved on the account, so the seeded trader opens on whatever
 * market was last used — which, after a spec that walks through the catalogue,
 * can be a stock that is closed out of hours and has no ticket at all. Any spec
 * that needs to trade says which market it means rather than inheriting one.
 */
export async function openMarket(page: Page, search: string, pair: string): Promise<void> {
  await page.waitForSelector('canvas');

  // the rail is a column on a desktop and a sheet behind the header on a phone
  const field = page.getByLabel('Search markets');
  if (!(await field.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Change market' }).first().click();
    await expect(field).toBeVisible();
  }

  await field.fill(search);
  await page.getByRole('button', { name: pair, exact: true }).first().click();
  if (await field.isVisible().catch(() => false)) {
    await field.fill('');
    // leaving the search box focused would swallow every hotkey that follows
    await field.blur();
  }
  await expect(page.locator('button:visible:has-text("Higher")').first()).toBeVisible();
}

/** The account switcher pill, whichever account it currently names. */
export const accountPill = (page: Page) => page.getByRole('button', { name: /^Trading account:/ });

/** The switcher's open menu. */
export const accountMenu = (page: Page) => page.getByRole('menu', { name: 'Trading accounts' });

/** Moves the terminal onto live money, so a position is staked from it. */
export async function useLiveAccount(page: Page): Promise<void> {
  await accountPill(page).click();
  await accountMenu(page)
    .getByRole('menuitem', { name: /Live account/ })
    .click();
  await expect(accountPill(page)).toHaveAttribute('aria-label', 'Trading account: Live');
}

/** Places a position on the account currently selected in the header. */
export async function placeTrade(page: Page, direction: 'Higher' | 'Lower', expiry = '30s'): Promise<void> {
  await page.waitForSelector('canvas');
  // scoped to the ticket, and exact: a loose `has-text("1m")` also matches a
  // closed market's "Opens in 7h 1m" row in the rail, which made this helper
  // fail once a minute depending on the clock
  const ticket = page.getByRole('region', { name: 'Order ticket' });
  await ticket
    .getByRole('group', { name: 'Expiry' })
    .getByRole('button', { name: expiry, exact: true })
    .click();
  await ticket.getByRole('button', { name: direction, exact: true }).click();
}

/**
 * Funds the live balance through the real deposit flow, using the mock chain
 * watcher to stand in for an on-chain payment.
 */
export async function fundAccount(page: Page, preset = '$250'): Promise<void> {
  await page.goto('/wallet');
  await page.locator('button:has-text("Tether (TRC-20)")').first().click();
  await page.locator(`button:has-text("${preset}")`).first().click();
  await page.click('button:has-text("Get deposit address")');
  await expect(page.getByText('Awaiting deposit')).toBeVisible();
  await page.click('text=Simulate the incoming payment');
  await expect(page.getByText('Deposit credited')).toBeVisible({ timeout: 120_000 });
}

/** Fails the test on any console error or uncaught page error. */
/**
 * Sandboxed CI terminates TLS with its own CA, which Chromium rejects for
 * third-party origins (the web font). That is the environment, not the app, and
 * it carries no URL in the console text — so it is ignored here and replaced by
 * a stricter check: any *same-origin* request that fails is a real fault.
 */
const ENVIRONMENT_NOISE = [/net::ERR_CERT_AUTHORITY_INVALID/];

export function failOnPageErrors(page: Page, ignore: RegExp[] = []): string[] {
  const errors: string[] = [];
  const patterns = [...ENVIRONMENT_NOISE, ...ignore];
  const keep = (text: string) => !patterns.some((pattern) => pattern.test(text));

  page.on('pageerror', (error) => {
    if (keep(error.message)) errors.push(`pageerror: ${error.message}`);
  });
  page.on('console', (message) => {
    if (message.type() === 'error' && keep(message.text())) errors.push(`console: ${message.text()}`);
  });
  page.on('requestfailed', (request) => {
    const url = request.url();
    if (!url.includes('localhost') && !url.startsWith('/')) return;
    // a request the browser cancelled because the page moved on is not a fault
    const reason = request.failure()?.errorText ?? '';
    if (reason.includes('ERR_ABORTED')) return;
    errors.push(`requestfailed: ${url} ${reason}`);
  });
  return errors;
}

export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, 'page scrolls horizontally').toBeLessThanOrEqual(1);
}

/**
 * Reads a message out of the platform's outbox.
 *
 * Since the Email task, nothing hands a confirmation or reset link back
 * through the API — the link only exists inside the email. The back office
 * keeps every message it composed, so that is where a test looks for one,
 * the same place an operator would.
 */
export async function latestEmail(
  base: string,
  options: { to: string; template?: string },
): Promise<{ subject: string; html: string; text: string }> {
  const context = await apiRequest.newContext({ baseURL: base });
  try {
    const accessToken = await adminApiToken(context);
    const headers = { authorization: `Bearer ${accessToken}` };

    const params = new URLSearchParams({ search: options.to, pageSize: '5' });
    if (options.template) params.set('template', options.template);

    // the send is fire-and-forget on some paths, so give it a moment to land
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const list = await context.get(`/api/admin/emails?${params}`, { headers });
      const { emails } = (await list.json()) as { emails: { id: string }[] };
      if (emails.length > 0) {
        const one = await context.get(`/api/admin/emails/${emails[0].id}`, { headers });
        const { email } = (await one.json()) as {
          email: { subject: string; html: string; text: string };
        };
        return email;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`no ${options.template ?? 'email'} in the outbox for ${options.to}`);
  } finally {
    await context.dispose();
  }
}

/** The first link in a message body, which is what every template's button is. */
export function linkIn(email: { text: string }, path: string): string {
  const match = new RegExp(`https?://[^\\s]*${path}[^\\s]*`).exec(email.text);
  if (!match) throw new Error(`no ${path} link in the email`);
  return match[0];
}
