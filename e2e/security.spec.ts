import { expect, test } from '@playwright/test';
import { totp } from '../server/src/lib/totp.js';
import { failOnPageErrors, latestEmail, linkIn, login, newCredentials, register } from './helpers';

/**
 * Registration and account security, through the browser.
 *
 * The confirmation link never comes back through the API — it only exists
 * inside the email — so the tests read it out of the outbox, which is where an
 * operator would look for it too.
 */

test.describe('registration', () => {
  test('rates the password while it is typed and refuses a weak one', async ({ page }) => {
    // the deliberate rejection at the end is a 400 the browser logs
    const errors = failOnPageErrors(page, [/status of 400/]);
    await page.goto('/register');

    const password = page.locator('#password');
    const meter = page.locator('#password-strength');

    await password.fill('abc');
    await expect(meter).toContainText('Too short');
    await expect(meter).toContainText('Use at least 8 characters');

    await password.fill('lowercaseonly');
    await expect(meter).toContainText('Mix upper case, lower case and numbers');

    await password.fill('Harbour7Lantern!Quay');
    await expect(meter).toContainText('Strong');
    await expect(meter).toContainText('This one is fine');

    // the meter is advice; the server holds the rule
    const credentials = newCredentials('weak');
    await page.fill('#name', credentials.name);
    await page.fill('#email', credentials.email);
    await password.fill('password1');
    await page.click('button[type=submit]');
    await expect(page.getByRole('alert')).toContainText('most common');
    await expect(page).toHaveURL(/\/register/);

    expect(errors).toEqual([]);
  });

  test('confirms the address from the emailed link', async ({ page, baseURL }) => {
    const credentials = newCredentials('sec');
    await register(page, credentials);

    // the banner nags until the address is proven
    await page.goto('/account');
    await expect(page.getByText('Confirm your email address so your account can be recovered')).toBeVisible();

    const email = await latestEmail(baseURL!, { to: credentials.email, template: 'verify-email' });
    expect(email.subject).toContain('Confirm your');
    const link = linkIn(email, '/verify-email');

    await page.goto(link);
    await expect(page.getByRole('heading', { name: 'Address confirmed' })).toBeVisible();

    await page.goto('/account/security');
    await expect(page.getByText('confirmed', { exact: true })).toBeVisible();

    // and the same link cannot be used twice
    await page.goto(link);
    await expect(page.getByRole('heading', { name: 'That link did not work' })).toBeVisible();
  });

  test('emails a password reset link that works once', async ({ page, baseURL }) => {
    const credentials = newCredentials('reset');
    await register(page, credentials);
    await page.goto('/account');
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.waitForURL('**/login');

    await page.goto('/forgot-password');
    await page.fill('#email', credentials.email);
    await page.click('button[type=submit]');
    await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
    // the token is not in the response, and must not be
    await expect(page.locator('body')).not.toContainText('reset-password?token=');

    const email = await latestEmail(baseURL!, { to: credentials.email, template: 'reset-password' });
    await page.goto(linkIn(email, '/reset-password'));

    await page.fill('#password', 'Lantern9Harbour');
    await page.fill('#confirm', 'Lantern9Harbour');
    await page.click('button[type=submit]');
    await page.waitForURL('**/login');

    await login(page, { email: credentials.email, password: 'Lantern9Harbour' });
    await expect(page).toHaveURL(/\/trade/);
  });
});

test.describe('two-factor authentication', () => {
  test('enrols, then guards the next sign-in, and a backup code works once', async ({ page }) => {
    // a wrong code is answered with a 401, twice on purpose here
    const errors = failOnPageErrors(page, [/status of 401/]);
    const credentials = newCredentials('2fa');
    await register(page, credentials);

    await page.goto('/account/security');
    await page.getByRole('button', { name: 'Turn it on' }).click();

    // the key is shown so it can be typed in by hand; the test uses it as the app would
    const secret = (await page.locator('code').first().innerText()).trim();
    await expect(page.getByAltText('QR code for your authenticator app')).toBeVisible();

    await page.fill('#enrol-code', totp(secret));
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();

    await expect(page.getByText('Save these backup codes now')).toBeVisible();
    const codes = await page.locator('ul.font-mono li, li.tabular.rounded-lg').allInnerTexts();
    const backup = codes.map((code) => code.trim()).filter((code) => /^[A-Z0-9]{5}-[A-Z0-9]{5}$/.test(code));
    expect(backup).toHaveLength(10);
    await page.getByRole('button', { name: 'I have saved them' }).click();
    await expect(page.getByText('On since')).toBeVisible();

    // sign out and back in: the password alone no longer gets in
    await page.goto('/account');
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.waitForURL('**/login');

    await page.fill('#email', credentials.email);
    await page.fill('#password', credentials.password);
    await page.click('button[type=submit]');
    await expect(page.getByRole('heading', { name: 'One more step' })).toBeVisible();

    await page.fill('#code', '000000');
    await page.getByRole('button', { name: 'Confirm' }).click();
    await expect(page.getByRole('alert')).toContainText('not right');

    // a backup code gets in, and is then spent
    await page.fill('#code', backup[0]);
    await page.getByRole('button', { name: 'Confirm' }).click();
    await page.waitForURL('**/trade');

    await page.goto('/account');
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.waitForURL('**/login');
    await page.fill('#email', credentials.email);
    await page.fill('#password', credentials.password);
    await page.click('button[type=submit]');
    await page.fill('#code', backup[0]);
    await page.getByRole('button', { name: 'Confirm' }).click();
    await expect(page.getByRole('alert')).toContainText('not right');

    // and the app's own code still works
    await page.fill('#code', totp(secret));
    await page.getByRole('button', { name: 'Confirm' }).click();
    await page.waitForURL('**/trade');

    expect(errors).toEqual([]);
  });
});

test.describe('devices and history', () => {
  test('lists every signed-in device, and signs the others out', async ({ browser, page }) => {
    const credentials = newCredentials('devices');
    await register(page, credentials);

    // a second browser context is a second device as far as the server is concerned
    const second = await browser.newContext();
    const other = await second.newPage();
    await login(other, credentials);

    await page.goto('/account/security');
    const devices = page.getByRole('heading', { name: 'Devices' }).locator('..').locator('..');
    await expect(devices.getByText('this device')).toHaveCount(1);
    await expect(devices.locator('li')).toHaveCount(2);

    await page.getByRole('button', { name: 'Log out other devices' }).click();
    await expect(devices.locator('li')).toHaveCount(1);

    // the other device is now holding a revoked session
    await other.goto('/account');
    await expect(other).toHaveURL(/\/login/, { timeout: 30_000 });
    await second.close();
  });

  test('records failed attempts as well as successful ones', async ({ page }) => {
    const credentials = newCredentials('history');
    await register(page, credentials);
    await page.goto('/account');
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.waitForURL('**/login');

    await page.fill('#email', credentials.email);
    await page.fill('#password', 'NotTheRightOne1');
    await page.click('button[type=submit]');
    await expect(page.getByRole('alert')).toBeVisible();

    await login(page, credentials);
    await page.goto('/account/security');

    const history = page.getByRole('heading', { name: 'Recent sign-in attempts' }).locator('..');
    await expect(history.getByText('Wrong password')).toBeVisible();
    await expect(history.getByText('Signed in').first()).toBeVisible();
  });
});
