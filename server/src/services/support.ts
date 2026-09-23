import { EventEmitter } from 'node:events';
import type { SupportMessage, SupportTicket } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { conflict, forbidden, notFound } from '../lib/errors.js';

export const supportEvents = new EventEmitter();

const MAX_OPEN_TICKETS = 5;

export async function openTicket(userId: string, subject: string, body: string): Promise<SupportTicket> {
  const open = await prisma.supportTicket.count({ where: { userId, status: { not: 'CLOSED' } } });
  if (open >= MAX_OPEN_TICKETS)
    throw conflict('You already have several open conversations', 'too_many_tickets');

  const ticket = await prisma.$transaction(async (tx) => {
    const created = await tx.supportTicket.create({
      data: { userId, subject: subject.trim(), status: 'OPEN', unreadByAgent: 1, lastMessageAt: new Date() },
    });
    await tx.supportMessage.create({ data: { ticketId: created.id, senderId: userId, body: body.trim() } });
    return created;
  });

  supportEvents.emit('ticket', ticket);
  return ticket;
}

export interface PostMessageInput {
  ticketId: string;
  senderId: string;
  body: string;
  fromSupport: boolean;
}

export async function postMessage(input: PostMessageInput): Promise<SupportMessage> {
  const ticket = await prisma.supportTicket.findUnique({ where: { id: input.ticketId } });
  if (!ticket) throw notFound('Conversation not found');
  if (!input.fromSupport && ticket.userId !== input.senderId) throw forbidden('Not your conversation');
  if (ticket.status === 'CLOSED') throw conflict('This conversation is closed', 'closed');

  const message = await prisma.$transaction(async (tx) => {
    const created = await tx.supportMessage.create({
      data: {
        ticketId: ticket.id,
        senderId: input.senderId,
        body: input.body.trim(),
        fromSupport: input.fromSupport,
      },
    });
    await tx.supportTicket.update({
      where: { id: ticket.id },
      data: {
        lastMessageAt: new Date(),
        status: input.fromSupport ? 'ANSWERED' : 'OPEN',
        // each side's unread counter is bumped for the other party
        ...(input.fromSupport
          ? { unreadByUser: { increment: 1 }, unreadByAgent: 0 }
          : { unreadByAgent: { increment: 1 }, unreadByUser: 0 }),
      },
    });
    return created;
  });

  supportEvents.emit('message', { message, userId: ticket.userId, subject: ticket.subject });
  return message;
}

export async function listTickets(userId: string) {
  return prisma.supportTicket.findMany({
    where: { userId },
    orderBy: { lastMessageAt: 'desc' },
    take: 20,
    include: { messages: { orderBy: { createdAt: 'asc' }, take: 100 } },
  });
}

export async function readTicket(ticketId: string, userId: string, isAgent: boolean) {
  const ticket = await prisma.supportTicket.findUnique({
    where: { id: ticketId },
    include: { messages: { orderBy: { createdAt: 'asc' }, take: 200 } },
  });
  if (!ticket) throw notFound('Conversation not found');
  if (!isAgent && ticket.userId !== userId) throw forbidden('Not your conversation');

  // opening a conversation clears that side's unread badge
  await prisma.supportTicket.update({
    where: { id: ticketId },
    data: isAgent ? { unreadByAgent: 0 } : { unreadByUser: 0 },
  });
  return ticket;
}

export async function setTicketStatus(ticketId: string, status: 'OPEN' | 'ANSWERED' | 'CLOSED') {
  const ticket = await prisma.supportTicket.update({ where: { id: ticketId }, data: { status } });
  supportEvents.emit('ticket', ticket);
  return ticket;
}

export function unreadCount(userId: string) {
  return prisma.supportTicket.aggregate({ _sum: { unreadByUser: true }, where: { userId } });
}
