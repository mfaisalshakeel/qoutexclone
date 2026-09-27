import { expect, test } from '@playwright/test';
import { ADMIN, adminApiToken, failOnPageErrors, login, newCredentials, register } from './helpers';

// starts with the real JPEG signature (FF D8 FF) the server sniffs for —
// content past that is arbitrary, since this is not decoded, only stored
const FAKE_JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
const FAKE_TEXT_FILE = Buffer.from('this is not an image, whatever its name claims');

test.describe('KYC document upload', () => {
  test('a trader submits identity verification with a real document, and an admin can review and open it', async ({
    page,
    request,
  }) => {
    const errors = failOnPageErrors(page);
    const credentials = await register(page, newCredentials('kyc'));

    await page.goto('/account');
    await expect(page.getByRole('heading', { name: 'Identity verification' })).toBeVisible();

    await page.fill('#kyc-name', 'E2E Test Trader');
    await page.fill('#kyc-dob', '1992-03-14');
    await page.fill('#kyc-country', 'Pakistan');
    await page.selectOption('#kyc-doc-type', 'PASSPORT');
    await page.fill('#kyc-doc-number', 'P1234567');
    await page.fill('#kyc-address', '221B Somewhere Street, Lahore');
    await page.setInputFiles('#kyc-document', {
      name: 'passport.jpg',
      mimeType: 'image/jpeg',
      buffer: FAKE_JPEG,
    });

    await page.click('button:has-text("Submit for verification")');
    await expect(page.getByText('pending')).toBeVisible();

    // the admin back office sees the same submission, with a real document behind it
    const token = await adminApiToken(request);
    const list = await request
      .get('/api/admin/kyc?search=' + encodeURIComponent(credentials.email), {
        headers: { authorization: `Bearer ${token}` },
      })
      .then((r) => r.json());
    const submission = list.submissions[0];
    expect(submission.documentRef).toBeTruthy();

    const doc = await request.get(`/api/admin/kyc/${submission.id}/document`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(doc.ok()).toBeTruthy();
    expect(doc.headers()['content-type']).toContain('image/jpeg');
    const bytes = await doc.body();
    expect(Buffer.compare(bytes, FAKE_JPEG)).toBe(0);

    // and approving it in the browser reaches the trader's own status — a
    // fresh session, since the trader is still signed in on this page
    await page.evaluate(() => localStorage.clear());
    await login(page, ADMIN);
    await page.goto('/admin/kyc');
    await page.fill('input[placeholder*="Search" i]', credentials.email);
    // the search itself is proof enough that it scoped down to this one
    // trader — matching on the shared "E2E Test Trader" name would also hit
    // leftover rows from earlier runs
    const row = page.locator('tr:visible, li:visible').filter({ hasText: credentials.email });
    await expect(row).toHaveCount(1);
    await row.getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByText('Identity verified')).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('the server refuses a file that is not really a JPEG, PNG or PDF, even with the right extension', async ({
    request,
  }) => {
    const credentials = newCredentials('kyc-reject');
    const registerRes = await request.post('/api/auth/register', {
      data: { email: credentials.email, password: credentials.password, name: credentials.name },
    });
    const { accessToken } = await registerRes.json();

    const res = await request.post('/api/me/kyc', {
      headers: { authorization: `Bearer ${accessToken}` },
      multipart: {
        fullName: 'Rejected Trader',
        dateOfBirth: '1990-01-01',
        country: 'Pakistan',
        address: '1 Somewhere',
        documentType: 'PASSPORT',
        documentNumber: 'X0000000',
        document: {
          name: 'passport.jpg',
          mimeType: 'image/jpeg',
          buffer: FAKE_TEXT_FILE,
        },
      },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('unsupported_file_type');
  });

  test('a signed-in trader who is not an admin cannot fetch anyone’s KYC document', async ({
    page,
    request,
  }) => {
    const credentials = await register(page, newCredentials('kyc-idor'));
    await page.goto('/account');
    await page.fill('#kyc-name', 'Private Trader');
    await page.fill('#kyc-dob', '1988-07-01');
    await page.fill('#kyc-country', 'Pakistan');
    await page.selectOption('#kyc-doc-type', 'ID_CARD');
    await page.fill('#kyc-doc-number', 'ID999999');
    await page.fill('#kyc-address', 'Somewhere else');
    await page.setInputFiles('#kyc-document', {
      name: 'id.jpg',
      mimeType: 'image/jpeg',
      buffer: FAKE_JPEG,
    });
    await page.click('button:has-text("Submit for verification")');
    await expect(page.getByText('pending')).toBeVisible();

    const adminToken = await adminApiToken(request);
    const list = await request
      .get('/api/admin/kyc?search=' + encodeURIComponent(credentials.email), {
        headers: { authorization: `Bearer ${adminToken}` },
      })
      .then((r) => r.json());
    const submissionId = list.submissions[0].id;

    // this trader's own real session token — not an admin, not the document's owner either
    const traderToken = await page.evaluate(() => localStorage.getItem('qx.access'));
    const res = await request.get(`/api/admin/kyc/${submissionId}/document`, {
      headers: { authorization: `Bearer ${traderToken}` },
    });
    expect(res.status()).toBe(403);
  });
});
