import { expect, test } from '@playwright/test';
import { ADMIN, adminApiToken, failOnPageErrors, login, newCredentials, register } from './helpers';

test.describe('content CMS', () => {
  test('a legal page, a FAQ entry and a homepage section can be drafted then published', async ({
    page,
    request,
  }) => {
    const errors = failOnPageErrors(page);
    await login(page, ADMIN);
    await page.goto('/admin/content');

    // both live sections this test publishes over are read back and restored
    // in `finally` — the homepage renders exactly this published copy, so a
    // stray test value left behind here would show up on the live site
    const token = await adminApiToken(request);
    const [originalLegal, originalHero] = await Promise.all([
      request
        .get('/api/admin/content/legal', { headers: { authorization: `Bearer ${token}` } })
        .then(async (res) => (await res.json()).pages.find((p: { slug: string }) => p.slug === 'terms')),
      request
        .get('/api/admin/content/homepage', { headers: { authorization: `Bearer ${token}` } })
        .then(async (res) => (await res.json()).sections.find((s: { key: string }) => s.key === 'hero')),
    ]);

    try {
      // legal pages: a draft alone changes nothing until it is published
      await page.getByRole('tab', { name: 'Legal pages' }).click();
      await page.getByRole('row', { name: /Terms of Service/ }).click();
      const legalBody = page.locator('#legal-body');
      await expect(legalBody).toBeVisible();
      const uniqueClause = `Uniquely testable clause ${Date.now()}.`;
      await legalBody.fill(uniqueClause);
      await page.getByRole('button', { name: 'Save draft' }).click();
      await expect(page.getByText('Draft saved')).toBeVisible();
      await page.getByRole('button', { name: 'Publish', exact: true }).click();
      await expect(page.getByText('Terms of Service published')).toBeVisible();
      await page.getByRole('button', { name: 'Close ✕' }).click();

      // homepage sections: the fixed list Phase 7 renders
      await page.getByRole('tab', { name: 'Homepage' }).click();
      await page.getByText('Hero', { exact: true }).click();
      const heroTitle = page.locator('#hs-title');
      await expect(heroTitle).toBeVisible();
      const newTitle = `Trade smarter ${Date.now()}`;
      await heroTitle.fill(newTitle);
      await page.getByRole('button', { name: 'Publish', exact: true }).click();
      await expect(page.getByText('Section published')).toBeVisible();
      await page.getByRole('button', { name: 'Close ✕' }).click();
      await expect(page.getByText(newTitle)).toBeVisible();

      // FAQ: added as a draft, then published from the list
      await page.getByRole('tab', { name: 'FAQ' }).click();
      const question = `Is this a real question ${Date.now()}?`;
      await page.fill('#faq-category', 'Testing');
      await page.fill('#faq-question', question);
      await page.fill('#faq-answer', 'Yes, and here is the answer.');
      await page.getByRole('button', { name: 'Add question' }).click();
      await expect(page.getByText('Question added as a draft')).toBeVisible();
      const row = page.getByRole('row', { name: new RegExp(question.replace(/[?]/g, '\\?')) });
      await expect(row).toBeVisible();
      await expect(row.getByText('draft')).toBeVisible();
      await row.getByRole('button', { name: 'Publish', exact: true }).click();
      await expect(row.getByText('active')).toBeVisible();

      expect(errors).toEqual([]);
    } finally {
      await request.put('/api/admin/content/legal/terms', {
        headers: { authorization: `Bearer ${token}` },
        data: { body: originalLegal.draftBody },
      });
      await request.post('/api/admin/content/legal/terms/publish', {
        headers: { authorization: `Bearer ${token}` },
      });
      await request.put('/api/admin/content/homepage/hero', {
        headers: { authorization: `Bearer ${token}` },
        data: {
          title: originalHero.draftTitle,
          subtitle: originalHero.draftSubtitle,
          body: originalHero.draftBody,
        },
      });
      await request.post('/api/admin/content/homepage/hero/publish', {
        headers: { authorization: `Bearer ${token}` },
      });
    }
  });

  test('a testimonial can be added, reaches the homepage, and disabling it removes it again', async ({
    browser,
  }) => {
    // the homepage only renders for a logged-out visitor (App.tsx redirects a
    // signed-in user straight to /trade), so this needs a separate context
    // from the admin session that creates and disables the testimonial
    const adminContext = await browser.newContext();
    const admin = await adminContext.newPage();
    const adminErrors = failOnPageErrors(admin);
    await login(admin, ADMIN);
    await admin.goto('/admin/content');
    await admin.getByRole('tab', { name: 'Testimonials' }).click();

    const name = `E2E Trader ${Date.now()}`;
    await admin.fill('#t-name', name);
    await admin.fill('#t-role', 'Trading since 2026');
    await admin.fill('#t-quote', 'This review only exists for the duration of a test run.');
    await admin.click('button:has-text("Add testimonial")');
    await expect(admin.getByText('Testimonial added')).toBeVisible();
    const row = admin.getByRole('row', { name: new RegExp(name) });
    await expect(row).toBeVisible();
    await expect(row.getByText('active')).toBeVisible();

    const visitorContext = await browser.newContext();
    const visitor = await visitorContext.newPage();
    const visitorErrors = failOnPageErrors(visitor);

    try {
      await visitor.goto('/');
      await expect(visitor.getByText(name)).toBeVisible();

      await admin
        .getByRole('row', { name: new RegExp(name) })
        .getByRole('button', { name: 'Disable' })
        .click();
      await expect(admin.getByRole('row', { name: new RegExp(name) }).getByText('closed')).toBeVisible();

      await visitor.goto('/');
      await expect(visitor.getByText(name)).toHaveCount(0);

      expect(adminErrors).toEqual([]);
      expect(visitorErrors).toEqual([]);
    } finally {
      // leave no e2e testimonial behind for other specs or a real visitor
      const cleanupRow = admin.getByRole('row', { name: new RegExp(name) });
      if (await cleanupRow.count()) {
        await cleanupRow.getByRole('button').first().click();
        await admin.getByRole('button', { name: 'Delete' }).click();
        await admin.getByRole('button', { name: 'Confirm delete' }).click();
      }
      await adminContext.close();
      await visitorContext.close();
    }
  });

  test('an announcement reaches the app shell and can be dismissed', async ({ browser }) => {
    const adminContext = await browser.newContext();
    const admin = await adminContext.newPage();
    const adminErrors = failOnPageErrors(admin);
    await login(admin, ADMIN);
    await admin.goto('/admin/content');
    await admin.getByRole('tab', { name: 'Announcements' }).click();

    const message = `E2E announcement ${Date.now()}`;
    await admin.fill('#an-message', message);
    await admin.selectOption('#an-style', 'warning');
    await admin.click('button:has-text("Create announcement")');
    await expect(admin.getByText('Announcement created')).toBeVisible();

    const traderContext = await browser.newContext();
    const trader = await traderContext.newPage();
    const traderErrors = failOnPageErrors(trader);
    await register(trader, newCredentials('cms'));
    // the terminal is full-bleed and suppresses every banner; anywhere else shows it
    await trader.goto('/wallet');
    await expect(trader.getByText(message)).toBeVisible();

    // dismissing hides it for this browser without touching the admin's own view
    await trader.getByLabel('Dismiss this announcement').click();
    await expect(trader.getByText(message)).toHaveCount(0);
    await trader.reload();
    await expect(trader.getByText(message)).toHaveCount(0);

    // switched off from the back office reaches every other viewer too
    const row = admin.getByRole('row', { name: new RegExp(message) });
    await row.getByRole('button').last().click();
    await expect(row.getByText('closed')).toBeVisible();

    expect(adminErrors).toEqual([]);
    expect(traderErrors).toEqual([]);
    await adminContext.close();
    await traderContext.close();
  });

  test('an email template can be customised and reverted', async ({ page }) => {
    // the preview iframe is sandboxed with no script permission at all — by
    // design, since it renders admin-authored copy — and Chrome logs that
    // block as a console error even though nothing the app sent it is a script
    const errors = failOnPageErrors(page, [/Blocked script execution/]);
    await login(page, ADMIN);
    await page.goto('/admin/email');
    await page.getByRole('tab', { name: 'Templates' }).click();

    await page.getByText('Confirm your address', { exact: true }).click();
    const subject = `Please confirm your account ${Date.now()}`;
    await page.fill('#et-subject', subject);
    await page.fill('#et-body', 'Confirm within {{hours}} hours on {{site}}.');
    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect(page.getByText('Template published')).toBeVisible();
    await expect(page.getByText('This template is live with custom copy.')).toBeVisible();
    const preview = page.getByRole('dialog', { name: 'Email preview' });
    await preview.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.getByText(subject)).toBeVisible();

    await page.getByText('Confirm your address', { exact: true }).click();
    await page.getByRole('button', { name: 'Revert to default' }).click();
    await expect(page.getByText('Reverted to the default copy')).toBeVisible();

    expect(errors).toEqual([]);
  });
});
