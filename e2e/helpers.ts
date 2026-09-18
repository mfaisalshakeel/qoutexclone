import { expect, type Page } from '@playwright/test';

export const ADMIN = { email: 'admin@quotexclone.dev', password: 'Admin123!' };
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

export async function login(page: Page, credentials: { email: string; password: string }): Promise<void> {
  await page.goto('/login');
  await page.fill('#email', credentials.email);
  await page.fill('#password', credentials.password);
  await page.click('button[type=submit]');
  await page.waitForURL('**/trade');
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
  const rail = page.getByRole('complementary').filter({ has: page.getByLabel('Search markets') });
  await rail.getByLabel('Search markets').fill(search);
  await rail.getByRole('button', { name: pair, exact: true }).first().click();
  await rail.getByLabel('Search markets').fill('');
  // leaving the search box focused would swallow every hotkey that follows
  await rail.getByLabel('Search markets').blur();
  await expect(page.locator('button:visible:has-text("Higher")').first()).toBeVisible();
}

/** Places a position on the account currently selected in the header. */
export async function placeTrade(page: Page, direction: 'Higher' | 'Lower', expiry = '30s'): Promise<void> {
  await page.waitForSelector('canvas');
  await page.locator(`button:visible:has-text("${expiry}")`).first().click();
  await page.locator(`button:visible:has-text("${direction}")`).first().click();
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
