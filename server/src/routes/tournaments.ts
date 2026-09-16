import { Router } from 'express';
import { z } from 'zod';
import { wrap } from '../lib/errors.js';
import { optionalAuth, requireActiveUser, requireAuth } from '../middleware/auth.js';
import { joinTournament, leaderboard, listTournaments } from '../services/tournaments.js';

const router = Router();

router.get(
  '/',
  optionalAuth,
  wrap(async (req, res) => {
    res.json({ tournaments: await listTournaments(req.user?.id) });
  }),
);

router.get(
  '/:id/leaderboard',
  optionalAuth,
  wrap(async (req, res) => {
    const limit = z.coerce.number().int().min(1).max(100).default(50).parse(req.query.limit ?? 50);
    res.json({ leaderboard: await leaderboard(req.params.id, limit) });
  }),
);

router.post(
  '/:id/join',
  requireAuth,
  requireActiveUser,
  wrap(async (req, res) => {
    const entry = await joinTournament(req.user!.id, req.params.id);
    res.status(201).json({ entry });
  }),
);

export default router;
