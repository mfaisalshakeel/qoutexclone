import { prisma } from '../lib/prisma.js';
import { log } from '../lib/logger.js';
import { settings } from './settings.js';

/**
 * Outgoing mail.
 *
 * Every message is written to the `EmailMessage` table before anything tries
 * to deliver it, so what the platform sent is auditable whether or not a
 * transport is configured — and so a deployment with no SMTP yet still has a
 * record an operator can read instead of a silently dropped verification link.
 *
 * The transport itself is pluggable. The default writes to the log; the SMTP
 * one is installed at boot when an operator has configured a server.
 */

export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Which template produced it, for the admin list and for tests. */
  template: string;
  userId?: string;
}

export interface MailTransport {
  readonly name: string;
  send(email: OutgoingEmail): Promise<void>;
}

/** The fallback: nothing leaves the machine, but nothing is lost either. */
const logTransport: MailTransport = {
  name: 'log',
  async send(email) {
    log.mail.info({ to: email.to, subject: email.subject, template: email.template }, 'email not delivered: no transport configured');
  },
};

let transport: MailTransport = logTransport;

export function setMailTransport(next: MailTransport | null): void {
  transport = next ?? logTransport;
}

export function mailTransportName(): string {
  return transport.name;
}

export interface SentEmail {
  id: string;
  status: 'SENT' | 'FAILED';
  error?: string;
}

/**
 * Queues, delivers and records one message.
 *
 * A delivery failure is never thrown at the caller: a broken SMTP server must
 * not fail a registration or a login. The row carries the error instead.
 */
export async function sendMail(email: OutgoingEmail): Promise<SentEmail> {
  const row = await prisma.emailMessage.create({
    data: {
      userId: email.userId,
      to: email.to,
      subject: email.subject,
      template: email.template,
      html: email.html,
      text: email.text,
      transport: transport.name,
    },
  });

  try {
    await transport.send(email);
    await prisma.emailMessage.update({
      where: { id: row.id },
      data: { status: 'SENT', sentAt: new Date() },
    });
    return { id: row.id, status: 'SENT' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.mail.error({ err, to: email.to, template: email.template }, 'email delivery failed');
    await prisma.emailMessage.update({
      where: { id: row.id },
      data: { status: 'FAILED', error: message.slice(0, 500) },
    });
    return { id: row.id, status: 'FAILED', error: message };
  }
}

/** Where links in an email should point. */
export function siteUrl(path = ''): string {
  const base = settings.get('general.siteUrl').replace(/\/$/, '');
  return `${base}${path}`;
}
