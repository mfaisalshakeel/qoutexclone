import { expect, test } from '@playwright/test';
import { totp } from '../server/src/lib/totp.js';
import { ADMIN, failOnPageErrors, login } from './helpers';

/**
 * Back-office roles: a super admin creates a role-limited account, that
 * account can't get in at all until it turns on 2FA, and once it does its
 * nav and pages are scoped to the role it was given — never the whole panel.
 */
test.describe('admin roles', () => {
  test('a new staff account is locked out until 2FA is on, then scoped to its role', async ({
    browser,
  }) => {
    const adminContext = await browser.newContext();
    const admin = await adminContext.newPage();
    const errors = failOnPageErrors(admin, [/status of 403/]);
    await login(admin, ADMIN);

    const email = `finance-${Date.now()}@example.test`;
    const password = 'Thundercloud92';
    await admin.goto('/admin/staff');
    await expect(admin.getByRole('heading', { name: 'Admin users', level: 1 })).toBeVisible();
    await admin.fill('#s-name', 'Finance Tester');
    await admin.fill('#s-email', email);
    await admin.fill('#s-password', password);
    await admin.selectOption('#s-role', 'FINANCE');
    await admin.getByRole('button', { name: 'Add' }).click();
    const staffRow = admin.getByRole('row', { name: new RegExp(email) });
    await expect(staffRow).toBeVisible();
    await expect(staffRow.getByText('Finance Tester')).toBeVisible();

    // the new account signs in fine — the gate is on the back office, not the app
    const staffContext = await browser.newContext();
    const staff = await staffContext.newPage();
    await login(staff, { email, password });

    // locked out of the back office until a second factor is enrolled
    await staff.goto('/admin');
    await expect(staff.getByText('Turn on two-factor to continue')).toBeVisible();
    await staff.getByRole('link', { name: 'Go to Account → Security' }).click();
    await staff.waitForURL('**/account/security');

    await staff.getByRole('button', { name: 'Turn it on' }).click();
    const secret = (await staff.locator('code').first().innerText()).trim();
    await staff.fill('#enrol-code', totp(secret));
    await staff.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(staff.getByText('Save these backup codes now')).toBeVisible();
    await staff.getByRole('button', { name: 'I have saved them' }).click();

    // now in, and scoped: finance's own area works, risk and settings do not
    await staff.goto('/admin');
    await expect(staff.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    const sidebar = staff.getByRole('navigation');
    await expect(sidebar.getByRole('link', { name: /^Withdrawals/ })).toBeVisible();
    await expect(sidebar.getByRole('link', { name: 'Risk', exact: true })).toHaveCount(0);
    await expect(sidebar.getByRole('link', { name: 'Admin users' })).toHaveCount(0);
    await expect(sidebar.getByRole('link', { name: 'Settings' })).toHaveCount(0);

    await staff.goto('/admin/withdrawals');
    await expect(staff.getByRole('heading', { name: 'Withdrawals', level: 1 })).toBeVisible();

    // a direct URL to a section the role doesn't hold lands on a clear refusal,
    // not a broken page making requests the server would reject anyway
    await staff.goto('/admin/risk');
    await expect(staff.getByText("Not available for your role")).toBeVisible();
    await staff.goto('/admin/staff');
    await expect(staff.getByText("Not available for your role")).toBeVisible();

    // on the traders list, finance can adjust a balance but not suspend an account
    await staff.goto('/admin/users');
    await expect(staff.getByRole('heading', { name: 'Traders', level: 1 })).toBeVisible();
    await expect(staff.getByRole('button', { name: 'Adjust' }).first()).toBeVisible();
    await expect(staff.getByRole('button', { name: 'Suspend' })).toHaveCount(0);

    expect(errors).toEqual([]);
    await adminContext.close();
    await staffContext.close();
  });

  test("a super admin's own row can't change its own role or suspend itself", async ({ page }) => {
    const errors = failOnPageErrors(page);
    await login(page, ADMIN);
    await page.goto('/admin/staff');

    const row = page.getByRole('row', { name: new RegExp(ADMIN.email) });
    await expect(row.getByText('you')).toBeVisible();
    await expect(row.locator('select')).toBeDisabled();
    await expect(row.getByRole('button', { name: /Suspend|Activate/ })).toBeDisabled();

    expect(errors).toEqual([]);
  });
});
