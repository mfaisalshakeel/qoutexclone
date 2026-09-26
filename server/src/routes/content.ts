import { Router } from 'express';
import { notFound, wrap } from '../lib/errors.js';
import {
  activeAnnouncements,
  isLegalSlug,
  publicFaqEntries,
  publicHomepageSections,
  publicLegalPage,
  publicTestimonials,
} from '../services/content.js';
import { listMethods } from '../services/payments.js';

/**
 * Public, unauthenticated content: everything the marketing site and help
 * centre render for a visitor who is not signed in. Every reader here
 * returns only *published* copy — a draft in progress never reaches this
 * router, whatever the admin API exposes for editing.
 */
const router = Router();

router.get(
  '/announcements',
  wrap(async (_req, res) => {
    const announcements = await activeAnnouncements();
    res.json({ announcements });
  }),
);

router.get(
  '/homepage',
  wrap(async (_req, res) => {
    res.json({ sections: await publicHomepageSections() });
  }),
);

router.get(
  '/faq',
  wrap(async (_req, res) => {
    res.json({ entries: await publicFaqEntries() });
  }),
);

router.get(
  '/legal/:slug',
  wrap(async (req, res) => {
    const slug = req.params.slug;
    if (!isLegalSlug(slug)) throw notFound('No such legal page');
    const page = await publicLegalPage(slug);
    if (!page) throw notFound('That page has not been published yet');
    res.json({ page });
  }),
);

router.get(
  '/testimonials',
  wrap(async (_req, res) => {
    res.json({ testimonials: await publicTestimonials() });
  }),
);

router.get(
  '/payment-methods',
  wrap(async (_req, res) => {
    const methods = await listMethods();
    res.json({
      methods: methods.map((m) => ({
        key: m.key,
        label: m.label,
        provider: m.provider,
        currency: m.currency,
        network: m.network,
      })),
    });
  }),
);

export default router;
