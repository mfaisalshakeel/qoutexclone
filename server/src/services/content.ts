import { prisma } from '../lib/prisma.js';
import { log } from '../lib/logger.js';
import { badRequest, notFound } from '../lib/errors.js';

/**
 * The content CMS: legal pages, FAQ, homepage sections, announcements and
 * email-template copy overrides. Long-form documents (legal pages, homepage
 * sections, email overrides) keep a draft separate from what is published, so
 * an edit in progress never reaches a trader; short list items (FAQ entries,
 * announcements) are simple enough that a visibility flag is the whole publish
 * state, and there is no second copy of the same content to keep in sync.
 */

/* ------------------------------ legal pages ------------------------------ */

export const LEGAL_PAGES = [
  { slug: 'terms', title: 'Terms of Service' },
  { slug: 'privacy', title: 'Privacy Policy' },
  { slug: 'risk-disclosure', title: 'Risk Disclosure' },
  { slug: 'aml-kyc', title: 'AML / KYC Policy' },
  { slug: 'cookie-policy', title: 'Cookie Policy' },
] as const;
export type LegalSlug = (typeof LEGAL_PAGES)[number]['slug'];
const LEGAL_SLUGS = new Set<string>(LEGAL_PAGES.map((p) => p.slug));
export function isLegalSlug(slug: string): slug is LegalSlug {
  return LEGAL_SLUGS.has(slug);
}

/** Every legal slug, in the fixed order, seeded with an empty draft if nothing has been written yet. */
export async function listLegalPages() {
  const rows = await prisma.legalPage.findMany();
  const bySlug = new Map(rows.map((row) => [row.slug, row]));
  return LEGAL_PAGES.map(({ slug, title }) => {
    const row = bySlug.get(slug);
    return (
      row ?? {
        id: null,
        slug,
        title,
        draftBody: '',
        publishedBody: null,
        publishedAt: null,
        updatedAt: null,
      }
    );
  });
}

export async function saveLegalPageDraft(slug: LegalSlug, body: string) {
  const title = LEGAL_PAGES.find((p) => p.slug === slug)!.title;
  return prisma.legalPage.upsert({
    where: { slug },
    update: { draftBody: body },
    create: { slug, title, draftBody: body },
  });
}

/** What the public legal pages actually show: only what has ever been published. */
export async function publicLegalPage(slug: LegalSlug) {
  const page = await prisma.legalPage.findUnique({ where: { slug } });
  const title = LEGAL_PAGES.find((p) => p.slug === slug)!.title;
  if (!page?.publishedAt) return null;
  return { slug, title, body: page.publishedBody, publishedAt: page.publishedAt };
}

export async function publishLegalPage(slug: LegalSlug) {
  const page = await prisma.legalPage.findUnique({ where: { slug } });
  if (!page) throw notFound('Nothing has been drafted for this page yet');
  return prisma.legalPage.update({
    where: { slug },
    data: { publishedBody: page.draftBody, publishedAt: new Date() },
  });
}

/* ---------------------------------- FAQ ----------------------------------- */

export async function listFaqEntries() {
  return prisma.faqEntry.findMany({ orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }] });
}

/** What the help centre actually shows: published entries only. */
export async function publicFaqEntries() {
  return prisma.faqEntry.findMany({
    where: { published: true },
    orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }],
    select: { id: true, category: true, question: true, answer: true, sortOrder: true },
  });
}

export async function createFaqEntry(data: {
  category: string;
  question: string;
  answer: string;
  sortOrder: number;
  published: boolean;
}) {
  return prisma.faqEntry.create({ data });
}

export async function updateFaqEntry(
  id: string,
  patch: Partial<{
    category: string;
    question: string;
    answer: string;
    sortOrder: number;
    published: boolean;
  }>,
) {
  const entry = await prisma.faqEntry.findUnique({ where: { id } });
  if (!entry) throw notFound('That FAQ entry does not exist');
  return prisma.faqEntry.update({ where: { id }, data: patch });
}

export async function deleteFaqEntry(id: string) {
  const entry = await prisma.faqEntry.findUnique({ where: { id } });
  if (!entry) throw notFound('That FAQ entry does not exist');
  await prisma.faqEntry.delete({ where: { id } });
}

/* ----------------------------- homepage sections --------------------------- */

export const HOMEPAGE_SECTIONS = [
  { key: 'hero', label: 'Hero' },
  { key: 'markets_strip', label: 'Live markets strip' },
  { key: 'how_it_works', label: 'How it works' },
  { key: 'platform_showcase', label: 'Platform showcase' },
  { key: 'features_grid', label: 'Features grid' },
  { key: 'status_levels', label: 'Account status levels' },
  { key: 'tournaments_teaser', label: 'Tournaments teaser' },
  { key: 'payment_methods', label: 'Payment methods' },
  { key: 'security', label: 'Security & risk disclosure' },
  { key: 'testimonials', label: 'Testimonials' },
  { key: 'faq_accordion', label: 'FAQ accordion intro' },
  { key: 'final_cta', label: 'Final call to action' },
  { key: 'footer', label: 'Footer' },
] as const;
export type HomepageSectionKey = (typeof HOMEPAGE_SECTIONS)[number]['key'];
const HOMEPAGE_KEYS = new Set<string>(HOMEPAGE_SECTIONS.map((s) => s.key));
export function isHomepageSectionKey(key: string): key is HomepageSectionKey {
  return HOMEPAGE_KEYS.has(key);
}

export async function listHomepageSections() {
  const rows = await prisma.homepageSection.findMany();
  const byKey = new Map(rows.map((row) => [row.key, row]));
  return HOMEPAGE_SECTIONS.map(({ key, label }) => {
    const row = byKey.get(key);
    return row
      ? { ...row, label }
      : {
          id: null,
          key,
          label,
          draftTitle: null,
          draftSubtitle: null,
          draftBody: null,
          publishedTitle: null,
          publishedSubtitle: null,
          publishedBody: null,
          publishedAt: null,
          updatedAt: null,
        };
  });
}

/** What the homepage actually renders: published copy only, keyed for easy lookup, sections never drafted yet simply absent. */
export async function publicHomepageSections(): Promise<
  Record<string, { title: string | null; subtitle: string | null; body: string | null }>
> {
  const rows = await prisma.homepageSection.findMany({ where: { publishedAt: { not: null } } });
  const out: Record<string, { title: string | null; subtitle: string | null; body: string | null }> = {};
  for (const row of rows) {
    out[row.key] = { title: row.publishedTitle, subtitle: row.publishedSubtitle, body: row.publishedBody };
  }
  return out;
}

export async function saveHomepageSectionDraft(
  key: HomepageSectionKey,
  patch: { title?: string | null; subtitle?: string | null; body?: string | null },
) {
  return prisma.homepageSection.upsert({
    where: { key },
    update: {
      draftTitle: patch.title,
      draftSubtitle: patch.subtitle,
      draftBody: patch.body,
    },
    create: {
      key,
      draftTitle: patch.title,
      draftSubtitle: patch.subtitle,
      draftBody: patch.body,
    },
  });
}

export async function publishHomepageSection(key: HomepageSectionKey) {
  const section = await prisma.homepageSection.findUnique({ where: { key } });
  if (!section) throw notFound('Nothing has been drafted for this section yet');
  return prisma.homepageSection.update({
    where: { key },
    data: {
      publishedTitle: section.draftTitle,
      publishedSubtitle: section.draftSubtitle,
      publishedBody: section.draftBody,
      publishedAt: new Date(),
    },
  });
}

/* ------------------------------ testimonials ------------------------------ */

export async function listTestimonials() {
  return prisma.testimonial.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
}

/** What the homepage actually shows: enabled, in the order an operator set. */
export async function publicTestimonials() {
  return prisma.testimonial.findMany({
    where: { enabled: true },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  });
}

export async function createTestimonial(data: {
  name: string;
  role: string;
  quote: string;
  avatar: string;
  rating: number;
  sortOrder: number;
  enabled: boolean;
}) {
  return prisma.testimonial.create({ data });
}

export async function updateTestimonial(
  id: string,
  patch: Partial<{
    name: string;
    role: string;
    quote: string;
    avatar: string;
    rating: number;
    sortOrder: number;
    enabled: boolean;
  }>,
) {
  const testimonial = await prisma.testimonial.findUnique({ where: { id } });
  if (!testimonial) throw notFound('That testimonial does not exist');
  return prisma.testimonial.update({ where: { id }, data: patch });
}

export async function deleteTestimonial(id: string) {
  const testimonial = await prisma.testimonial.findUnique({ where: { id } });
  if (!testimonial) throw notFound('That testimonial does not exist');
  await prisma.testimonial.delete({ where: { id } });
}

/* ------------------------------ announcements ------------------------------ */

const ANNOUNCEMENT_STYLES = ['info', 'warning', 'success'] as const;
export type AnnouncementStyle = (typeof ANNOUNCEMENT_STYLES)[number];
export function isAnnouncementStyle(style: string): style is AnnouncementStyle {
  return (ANNOUNCEMENT_STYLES as readonly string[]).includes(style);
}

export async function listAnnouncements() {
  return prisma.announcement.findMany({ orderBy: { createdAt: 'desc' } });
}

/** What every logged-in page shows right now: active, and inside its own date window if it set one. */
export async function activeAnnouncements() {
  const now = new Date();
  return prisma.announcement.findMany({
    where: {
      active: true,
      AND: [
        { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
        { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
      ],
    },
    orderBy: { createdAt: 'desc' },
  });
}

export async function createAnnouncement(data: {
  message: string;
  style: AnnouncementStyle;
  linkLabel: string | null;
  linkUrl: string | null;
  active: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
}) {
  return prisma.announcement.create({ data });
}

export async function updateAnnouncement(
  id: string,
  patch: Partial<{
    message: string;
    style: AnnouncementStyle;
    linkLabel: string | null;
    linkUrl: string | null;
    active: boolean;
    startsAt: Date | null;
    endsAt: Date | null;
  }>,
) {
  const announcement = await prisma.announcement.findUnique({ where: { id } });
  if (!announcement) throw notFound('That announcement does not exist');
  return prisma.announcement.update({ where: { id }, data: patch });
}

export async function deleteAnnouncement(id: string) {
  const announcement = await prisma.announcement.findUnique({ where: { id } });
  if (!announcement) throw notFound('That announcement does not exist');
  await prisma.announcement.delete({ where: { id } });
}

/* --------------------------- email template overrides --------------------------- */

/**
 * One row per template `email-preview.ts` already names, with the fixed
 * options each one's copy can reference. Only the branch `previewAll()`
 * treats as representative is overridable (a rejection reason, a withdrawal
 * note and the "no prize" tournament outcome are per-request data, not fixed
 * copy, and stay coded); the rest of the message — buttons, footer, and any
 * amount or status it reports — is structure, not copy, and cannot be
 * overridden here.
 */
export const EMAIL_TEMPLATE_KEYS = [
  { key: 'verify-email', label: 'Confirm your address', placeholders: ['name', 'site', 'hours'] },
  { key: 'reset-password', label: 'Reset your password', placeholders: ['name', 'site', 'minutes'] },
  { key: 'new-device', label: 'New device signed in', placeholders: ['name', 'site'] },
  { key: 'two-factor-on', label: 'Two-factor turned on', placeholders: ['name', 'site'] },
  {
    key: 'deposit-credited',
    label: 'Deposit credited',
    placeholders: ['name', 'site', 'amount', 'bonus', 'bonusLine', 'currency', 'network'],
  },
  {
    key: 'withdrawal-completed',
    label: 'Withdrawal update',
    placeholders: ['name', 'site', 'amount', 'what'],
  },
  { key: 'kyc-approved', label: 'Identity check passed', placeholders: ['name', 'site'] },
  {
    key: 'tournament-result',
    label: 'Tournament result (a placed finish)',
    placeholders: ['name', 'site', 'tournament', 'ordinal', 'prize'],
  },
] as const;
export type EmailTemplateKey = (typeof EMAIL_TEMPLATE_KEYS)[number]['key'];
const EMAIL_KEYS = new Set<string>(EMAIL_TEMPLATE_KEYS.map((t) => t.key));
export function isEmailTemplateKey(key: string): key is EmailTemplateKey {
  return EMAIL_KEYS.has(key);
}

export async function listEmailOverrides() {
  const rows = await prisma.emailTemplateOverride.findMany();
  const byKey = new Map(rows.map((row) => [row.key, row]));
  return EMAIL_TEMPLATE_KEYS.map(({ key, label, placeholders }) => {
    const row = byKey.get(key);
    return {
      key,
      label,
      placeholders,
      draftSubject: row?.draftSubject ?? null,
      draftBody: row?.draftBody ?? null,
      publishedSubject: row?.publishedSubject ?? null,
      publishedBody: row?.publishedBody ?? null,
      publishedAt: row?.publishedAt ?? null,
      updatedAt: row?.updatedAt ?? null,
    };
  });
}

export async function saveEmailOverrideDraft(
  key: EmailTemplateKey,
  patch: { subject: string | null; body: string | null },
) {
  const row = await prisma.emailTemplateOverride.upsert({
    where: { key },
    update: { draftSubject: patch.subject, draftBody: patch.body },
    create: { key, draftSubject: patch.subject, draftBody: patch.body },
  });
  return row;
}

export async function publishEmailOverride(key: EmailTemplateKey) {
  const row = await prisma.emailTemplateOverride.findUnique({ where: { key } });
  if (!row) throw notFound('Nothing has been drafted for this template yet');
  const updated = await prisma.emailTemplateOverride.update({
    where: { key },
    data: {
      publishedSubject: row.draftSubject,
      publishedBody: row.draftBody,
      publishedAt: new Date(),
    },
  });
  emailOverrideCache.set(key, { subject: updated.publishedSubject, body: updated.publishedBody });
  return updated;
}

/** Reverts a published template back to the platform's own hardcoded copy. */
export async function unpublishEmailOverride(key: EmailTemplateKey) {
  if (!(await prisma.emailTemplateOverride.findUnique({ where: { key } }))) {
    throw notFound('Nothing is published for this template');
  }
  const updated = await prisma.emailTemplateOverride.update({
    where: { key },
    data: { publishedSubject: null, publishedBody: null, publishedAt: null },
  });
  emailOverrideCache.delete(key);
  return updated;
}

/**
 * Cached, synchronous access to the published email overrides.
 *
 * `email-templates.ts` renders on hot, synchronous paths (deposit credited,
 * withdrawal updates) with unit tests that call it directly with no
 * database at all, so this mirrors the settings service's own cache-at-boot,
 * read-synchronously pattern rather than making every template async.
 */
class EmailOverrideCache {
  private cache = new Map<string, { subject: string | null; body: string | null }>();

  async load(): Promise<void> {
    try {
      const rows = await prisma.emailTemplateOverride.findMany({
        where: { publishedAt: { not: null } },
      });
      for (const row of rows) {
        this.cache.set(row.key, { subject: row.publishedSubject, body: row.publishedBody });
      }
      log.boot.info({ overrides: this.cache.size }, 'email template overrides loaded');
    } catch (err) {
      log.boot.error({ err }, 'could not load email template overrides, using platform defaults');
    }
  }

  get(key: string): { subject: string | null; body: string | null } | undefined {
    return this.cache.get(key);
  }

  set(key: string, value: { subject: string | null; body: string | null }): void {
    this.cache.set(key, value);
  }

  delete(key: string): void {
    this.cache.delete(key);
  }

  /** Test seam. */
  _clear(): void {
    this.cache.clear();
  }
}

export const emailOverrideCache = new EmailOverrideCache();

export function getEmailOverride(key: string): { subject: string | null; body: string | null } | undefined {
  return emailOverrideCache.get(key);
}

export function assertKnownEmailKey(key: string): asserts key is EmailTemplateKey {
  if (!isEmailTemplateKey(key)) throw badRequest(`Unknown email template: ${key}`, 'unknown_template');
}
