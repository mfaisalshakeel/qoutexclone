import { Router } from 'express';
import { z } from 'zod';
import { wrap } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { listTickets, openTicket, postMessage, readTicket, unreadCount } from '../services/support.js';

const router = Router();
router.use(requireAuth);

router.get(
  '/tickets',
  wrap(async (req, res) => {
    const [tickets, unread] = await Promise.all([listTickets(req.user!.id), unreadCount(req.user!.id)]);
    res.json({ tickets, unread: unread._sum.unreadByUser ?? 0 });
  }),
);

router.post(
  '/tickets',
  wrap(async (req, res) => {
    const body = z
      .object({ subject: z.string().min(3).max(120), message: z.string().min(2).max(2000) })
      .parse(req.body);
    const ticket = await openTicket(req.user!.id, body.subject, body.message);
    res.status(201).json({ ticket: await readTicket(ticket.id, req.user!.id, false) });
  }),
);

router.get(
  '/tickets/:id',
  wrap(async (req, res) => {
    res.json({ ticket: await readTicket(req.params.id, req.user!.id, false) });
  }),
);

router.post(
  '/tickets/:id/messages',
  wrap(async (req, res) => {
    const body = z.object({ message: z.string().min(1).max(2000) }).parse(req.body);
    const message = await postMessage({
      ticketId: req.params.id,
      senderId: req.user!.id,
      body: body.message,
      fromSupport: false,
    });
    res.status(201).json({ message });
  }),
);

export default router;
