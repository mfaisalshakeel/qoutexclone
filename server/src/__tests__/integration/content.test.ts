/**
 * The content CMS against a real database: draft-vs-published for the
 * long-form content (legal pages, homepage sections, email overrides), plain
 * CRUD for the short list items (FAQ entries, announcements), the
 * active-announcement date window, and — the one place this task actually
 * changes what a trader receives — that a published email override really is
 * what `email-templates.ts` renders once it is live.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

const TEST_DB = process.env.TEST_DATABASE_URL;
if (TEST_DB) process.env.DATABASE_URL = TEST_DB;

const suite = TEST_DB ? describe : describe.skip;

suite('content CMS', () => {
  let prisma: (typeof import('../../lib/prisma.js'))['prisma'];
  let content: typeof import('../../services/content.js');
  let emailTemplates: typeof import('../../services/email-templates.js');

  beforeAll(async () => {
    prisma = (await import('../../lib/prisma.js')).prisma;
    content = await import('../../services/content.js');
    emailTemplates = await import('../../services/email-templates.js');
  });

  afterEach(async () => {
    content.emailOverrideCache._clear();
    await prisma.legalPage.deleteMany({});
    await prisma.faqEntry.deleteMany({});
    await prisma.homepageSection.deleteMany({});
    await prisma.announcement.deleteMany({});
    await prisma.emailTemplateOverride.deleteMany({});
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.$disconnect();
  });

  describe('legal pages', () => {
    it('lists every fixed slug with an empty draft before anything is written', async () => {
      const pages = await content.listLegalPages();
      expect(pages.map((p) => p.slug)).toEqual([
        'terms',
        'privacy',
        'risk-disclosure',
        'aml-kyc',
        'cookie-policy',
      ]);
      expect(pages.every((p) => p.publishedBody === null)).toBe(true);
    });

    it('keeps a draft unpublished until publish is called', async () => {
      await content.saveLegalPageDraft('terms', 'Draft one.');
      let pages = await content.listLegalPages();
      let terms = pages.find((p) => p.slug === 'terms')!;
      expect(terms.draftBody).toBe('Draft one.');
      expect(terms.publishedBody).toBeNull();

      await content.saveLegalPageDraft('terms', 'Draft two.');
      const published = await content.publishLegalPage('terms');
      expect(published.publishedBody).toBe('Draft two.');
      expect(published.publishedAt).not.toBeNull();

      // a further draft edit does not touch what's already published
      await content.saveLegalPageDraft('terms', 'Draft three, not yet live.');
      pages = await content.listLegalPages();
      terms = pages.find((p) => p.slug === 'terms')!;
      expect(terms.draftBody).toBe('Draft three, not yet live.');
      expect(terms.publishedBody).toBe('Draft two.');
    });

    it('refuses to publish a slug with no draft at all', async () => {
      await expect(content.publishLegalPage('privacy')).rejects.toThrow();
    });
  });

  describe('FAQ entries', () => {
    it('creates, updates and deletes an entry', async () => {
      const entry = await content.createFaqEntry({
        category: 'Deposits',
        question: 'How long does a deposit take?',
        answer: 'Usually a few minutes.',
        sortOrder: 0,
        published: false,
      });
      expect(entry.published).toBe(false);

      const updated = await content.updateFaqEntry(entry.id, { published: true, answer: 'Under 10 minutes.' });
      expect(updated.published).toBe(true);
      expect(updated.answer).toBe('Under 10 minutes.');

      const listed = await content.listFaqEntries();
      expect(listed.map((e) => e.id)).toContain(entry.id);

      await content.deleteFaqEntry(entry.id);
      const afterDelete = await content.listFaqEntries();
      expect(afterDelete.map((e) => e.id)).not.toContain(entry.id);
    });

    it('refuses to update or delete an entry that does not exist', async () => {
      await expect(content.updateFaqEntry('missing-id', { published: true })).rejects.toThrow();
      await expect(content.deleteFaqEntry('missing-id')).rejects.toThrow();
    });
  });

  describe('homepage sections', () => {
    it('lists every fixed key and round-trips a draft through publish', async () => {
      const sections = await content.listHomepageSections();
      expect(sections.map((s) => s.key)).toContain('hero');

      await content.saveHomepageSectionDraft('hero', {
        title: 'Trade in seconds',
        subtitle: 'Up or down, your call.',
        body: null,
      });
      let list = await content.listHomepageSections();
      let hero = list.find((s) => s.key === 'hero')!;
      expect(hero.draftTitle).toBe('Trade in seconds');
      expect(hero.publishedTitle).toBeNull();

      const published = await content.publishHomepageSection('hero');
      expect(published.publishedTitle).toBe('Trade in seconds');
      expect(published.publishedSubtitle).toBe('Up or down, your call.');

      list = await content.listHomepageSections();
      hero = list.find((s) => s.key === 'hero')!;
      expect(hero.publishedTitle).toBe('Trade in seconds');
      // a section with a saved row must still carry its own fixed label —
      // it lives in code, not the database, and is easy to drop on the way
      expect(hero.label).toBe('Hero');
    });

    it('refuses to publish a section with no draft at all', async () => {
      await expect(content.publishHomepageSection('footer')).rejects.toThrow();
    });
  });

  describe('announcements', () => {
    it('shows only what is active and inside its own date window', async () => {
      const now = Date.now();
      const always = await content.createAnnouncement({
        message: 'Scheduled maintenance Sunday.',
        style: 'info',
        linkLabel: null,
        linkUrl: null,
        active: true,
        startsAt: null,
        endsAt: null,
      });
      const notYet = await content.createAnnouncement({
        message: 'Not live yet.',
        style: 'info',
        linkLabel: null,
        linkUrl: null,
        active: true,
        startsAt: new Date(now + 3_600_000),
        endsAt: null,
      });
      const expired = await content.createAnnouncement({
        message: 'Already over.',
        style: 'info',
        linkLabel: null,
        linkUrl: null,
        active: true,
        startsAt: null,
        endsAt: new Date(now - 3_600_000),
      });
      const turnedOff = await content.createAnnouncement({
        message: 'Switched off.',
        style: 'info',
        linkLabel: null,
        linkUrl: null,
        active: false,
        startsAt: null,
        endsAt: null,
      });

      const active = await content.activeAnnouncements();
      const ids = active.map((a) => a.id);
      expect(ids).toContain(always.id);
      expect(ids).not.toContain(notYet.id);
      expect(ids).not.toContain(expired.id);
      expect(ids).not.toContain(turnedOff.id);
    });
  });

  describe('email template overrides', () => {
    it('leaves the platform default in place until a draft is published', async () => {
      const before = emailTemplates.verifyEmail({ name: 'Amelia', url: 'https://x/verify', hours: 24 });
      expect(before.subject).toBe('Confirm your Quantex email address');

      await content.saveEmailOverrideDraft('verify-email', {
        subject: 'Please confirm, {{name}}',
        body: 'Confirm within {{hours}} hours on {{site}}.',
      });

      // a draft alone changes nothing a trader would receive
      const stillDefault = emailTemplates.verifyEmail({ name: 'Amelia', url: 'https://x/verify', hours: 24 });
      expect(stillDefault.subject).toBe('Confirm your Quantex email address');

      await content.publishEmailOverride('verify-email');

      const after = emailTemplates.verifyEmail({ name: 'Amelia', url: 'https://x/verify', hours: 24 });
      expect(after.subject).toBe('Please confirm, Amelia');
      expect(after.text).toContain('Confirm within 24 hours on Quantex.');

      await content.unpublishEmailOverride('verify-email');
      const restored = emailTemplates.verifyEmail({ name: 'Amelia', url: 'https://x/verify', hours: 24 });
      expect(restored.subject).toBe('Confirm your Quantex email address');
    });

    it('refuses to publish or unpublish a template with no draft at all', async () => {
      await expect(content.publishEmailOverride('reset-password')).rejects.toThrow();
      await expect(content.unpublishEmailOverride('reset-password')).rejects.toThrow();
    });

    it('loads only the published overrides at boot, ignoring drafts', async () => {
      await content.saveEmailOverrideDraft('kyc-approved', { subject: 'Draft only', body: null });
      await content.saveEmailOverrideDraft('two-factor-on', { subject: 'Published one', body: null });
      await content.publishEmailOverride('two-factor-on');

      content.emailOverrideCache._clear();
      await content.emailOverrideCache.load();

      expect(content.getEmailOverride('kyc-approved')).toBeUndefined();
      expect(content.getEmailOverride('two-factor-on')).toEqual({ subject: 'Published one', body: null });
    });
  });
});
