import { Router } from 'express';
import { wrap } from '../lib/errors.js';
import { activeAnnouncements } from '../services/content.js';

/** Public, unauthenticated content: the banner every page — logged in or not — checks for. */
const router = Router();

router.get(
  '/announcements',
  wrap(async (_req, res) => {
    const announcements = await activeAnnouncements();
    res.json({ announcements });
  }),
);

export default router;
