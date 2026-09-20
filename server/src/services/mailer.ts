import nodemailer, { type Transporter } from 'nodemailer';
import { prisma } from '../lib/prisma.js';
import { log } from '../lib/logger.js';
import { settings, settingsEvents } from './settings.js';

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
    log.mail.info(
      { to: email.to, subject: email.subject, template: email.template },
      'email not delivered: no transport configured',
    );
  },
};

let transport: MailTransport = logTransport;

export function setMailTransport(next: MailTransport | null): void {
  transport = next ?? logTransport;
}

export function mailTransportName(): string {
  return transport.name;
}

/* -------------------------------------------------------------------------- */
/* SMTP                                                                       */
/* -------------------------------------------------------------------------- */

export interface SmtpConfig {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  fromName: string;
  fromAddress: string;
  replyTo: string;
}

export function smtpConfig(): SmtpConfig {
  return {
    enabled: settings.get('email.enabled'),
    host: settings.get('email.host'),
    port: settings.get('email.port'),
    secure: settings.get('email.secure'),
    user: settings.get('email.user'),
    password: settings.get('email.password'),
    fromName: settings.get('email.fromName'),
    fromAddress: settings.get('email.fromAddress'),
    replyTo: settings.get('email.replyTo'),
  };
}

/** Whether the settings describe a server worth trying to connect to. */
export function smtpReady(config = smtpConfig()): boolean {
  return config.enabled && config.host.length > 0 && config.fromAddress.length > 0;
}

function buildSmtpTransport(config: SmtpConfig): MailTransport {
  let transporter: Transporter | null = null;
  const from = config.fromName ? `"${config.fromName}" <${config.fromAddress}>` : config.fromAddress;

  return {
    name: 'smtp',
    async send(email) {
      // built lazily and kept: nodemailer pools the connection itself
      transporter ??= nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        ...(config.user ? { auth: { user: config.user, pass: config.password } } : {}),
      });
      await transporter.sendMail({
        from,
        to: email.to,
        subject: email.subject,
        text: email.text,
        html: email.html,
        ...(config.replyTo ? { replyTo: config.replyTo } : {}),
      });
    },
  };
}

/**
 * Installs the transport the current settings describe.
 *
 * Called at boot and again whenever an email setting changes, so an operator
 * who fixes a password in the back office does not have to restart anything.
 */
export function configureMailer(): void {
  const config = smtpConfig();
  if (!smtpReady(config)) {
    setMailTransport(null);
    log.mail.info('no SMTP server configured: messages are recorded but not delivered');
    return;
  }
  setMailTransport(buildSmtpTransport(config));
  log.mail.info({ host: config.host, port: config.port }, 'SMTP transport ready');
}

/** Rebuilds the transport when any email setting is edited. */
export function watchMailSettings(): void {
  settingsEvents.on('changed', ({ key }: { key: string }) => {
    if (key.startsWith('email.')) configureMailer();
  });
}

/**
 * Sends a message through whatever is configured and reports what happened.
 *
 * Used by the back office's "send test email" button, which is the only way
 * an operator can tell a working SMTP configuration from a plausible one.
 */
export async function sendTestEmail(to: string): Promise<SentEmail> {
  const site = settings.get('general.siteName');
  return sendMail({
    to,
    subject: `${site} test email`,
    template: 'test',
    text: `This is a test message from ${site}. If it reached you, the SMTP settings are right.`,
    html: `<p>This is a test message from <strong>${site}</strong>. If it reached you, the SMTP settings are right.</p>`,
  });
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
