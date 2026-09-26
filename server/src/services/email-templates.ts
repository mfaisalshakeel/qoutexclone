import { settings } from './settings.js';
import { getEmailOverride } from './content.js';

/**
 * The HTML the platform sends.
 *
 * Plain tables and inline styles, because that is what mail clients render
 * reliably, and a text alternative for every one of them. The content is
 * written here rather than in the database so a template can never be missing;
 * the content CMS overrides the copy, not the structure — a published
 * override (see `content.ts`) replaces a template's subject and intro
 * sentence, and everything else (buttons, amounts, statuses, the footer) stays
 * exactly as coded.
 */

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

function escape(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Substitutes `{{name}}`-style placeholders in an admin-written override. */
function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (whole, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : whole,
  );
}

/** The subject and intro copy for one template: a published override if there is one, the platform default otherwise. */
function overridden(
  key: string,
  vars: Record<string, string>,
  fallbackSubject: string,
  fallbackBody: string,
): { subject: string; body: string } {
  const override = getEmailOverride(key);
  return {
    subject: override?.subject ? fill(override.subject, vars) : fallbackSubject,
    body: override?.body ? fill(override.body, vars) : fallbackBody,
  };
}

/**
 * The shell every message sits in.
 *
 * `title` is escaped here because it is the one field that carries a name a
 * person typed; `body` is HTML the caller composed, so the caller escapes
 * whatever it interpolates. Escaping in both places would print the entities.
 */
function layout(options: { title: string; body: string; action?: { label: string; url: string } }): string {
  const site = escape(settings.get('general.siteName'));
  const support = escape(settings.get('general.supportEmail'));
  const button = options.action
    ? `<tr><td style="padding:24px 0"><a href="${escape(options.action.url)}" style="background:#f6c445;border-radius:10px;color:#10141c;display:inline-block;font-weight:700;padding:13px 26px;text-decoration:none">${escape(options.action.label)}</a></td></tr>`
    : '';

  return `<!doctype html>
<html lang="en"><body style="background:#0b0e14;margin:0;padding:24px;font-family:system-ui,-apple-system,'Segoe UI',sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#141a24;border-radius:16px;padding:32px;color:#e2e8f0">
<tr><td style="font-size:20px;font-weight:800;color:#f6c445;padding-bottom:20px">${site}</td></tr>
<tr><td style="font-size:17px;font-weight:700;padding-bottom:12px">${escape(options.title)}</td></tr>
<tr><td style="font-size:14px;line-height:22px;color:#cbd5e1">${options.body}</td></tr>
${button}
<tr><td style="border-top:1px solid #243041;color:#64748b;font-size:12px;line-height:19px;padding-top:20px">
Trading carries risk and you can lose the money you put in. If you did not expect this email, reply to <a href="mailto:${support}" style="color:#94a3b8">${support}</a> and we will look into it.
</td></tr>
</table></body></html>`;
}

export function verifyEmail(options: { name: string; url: string; hours: number }): RenderedEmail {
  const site = settings.get('general.siteName');
  const { subject, body } = overridden(
    'verify-email',
    { name: options.name, site, hours: String(options.hours) },
    `Confirm your ${site} email address`,
    `Confirm this address to finish setting up your ${site} account. The link works for the next ${options.hours} hours.`,
  );
  return {
    subject,
    html: layout({
      title: `Hello ${options.name},`,
      body: `<p>${escape(body)}</p>`,
      action: { label: 'Confirm my email', url: options.url },
    }),
    text: `Hello ${options.name},\n\n${body}\n\n${options.url}`,
  };
}

export function newDeviceAlert(options: {
  name: string;
  device: string;
  ip: string;
  at: Date;
  url: string;
}): RenderedEmail {
  const site = settings.get('general.siteName');
  // there is no browser here to ask, so this reads the operator's own
  // configured zone rather than always printing UTC
  const when = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: settings.get('general.defaultTimezone'),
    timeZoneName: 'short',
  }).format(options.at);
  const { subject, body: intro } = overridden(
    'new-device',
    { name: options.name, site },
    `New sign-in to your ${site} account`,
    `Your account was signed in to from a device we have not seen before.`,
  );
  return {
    subject,
    html: layout({
      title: `Hello ${options.name},`,
      body:
        `<p>${escape(intro)}</p>` +
        `<p style="color:#94a3b8"><strong style="color:#e2e8f0">${escape(options.device)}</strong><br>IP ${escape(options.ip)}<br>${escape(when)}</p>` +
        `<p>If that was you, there is nothing to do. If it was not, change your password and sign the other devices out.</p>`,
      action: { label: 'Review my devices', url: options.url },
    }),
    text: `Hello ${options.name},\n\n${intro}\n\n${options.device}\nIP ${options.ip}\n${when}\n\nIf that was not you, change your password and sign the other devices out: ${options.url}`,
  };
}

export function twoFactorChanged(options: { name: string; enabled: boolean; url: string }): RenderedEmail {
  const site = settings.get('general.siteName');
  // only the "just turned on" confirmation is CMS copy — the "turned off"
  // warning is a security nudge, not marketing prose, and stays fixed
  const { subject, body } = options.enabled
    ? overridden(
        'two-factor-on',
        { name: options.name, site },
        `Two-factor authentication is on for your ${site} account`,
        `Two-factor authentication is now switched on. You will need a code from your authenticator app each time you sign in.`,
      )
    : {
        subject: `Two-factor authentication was turned off`,
        body: `Two-factor authentication was switched off on your account. If that was not you, turn it back on and change your password now.`,
      };
  return {
    subject,
    html: layout({
      title: `Hello ${options.name},`,
      body: `<p>${escape(body)}</p>`,
      action: { label: 'Open security settings', url: options.url },
    }),
    text: `Hello ${options.name},\n\n${body}\n\n${options.url}`,
  };
}

/** Money is cents everywhere inside the platform; email shows dollars. */
function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function resetPassword(options: { name: string; url: string; minutes: number }): RenderedEmail {
  const site = settings.get('general.siteName');
  const { subject, body: intro } = overridden(
    'reset-password',
    { name: options.name, site, minutes: String(options.minutes) },
    `Reset your ${site} password`,
    `Someone asked to reset the password on your ${site} account. The link below works for the next ${options.minutes} minutes and can be used once.`,
  );
  return {
    subject,
    html: layout({
      title: `Hello ${options.name},`,
      body: `<p>${escape(intro)}</p><p>If it was not you, ignore this email — nothing has changed.</p>`,
      action: { label: 'Choose a new password', url: options.url },
    }),
    text: `Hello ${options.name},\n\n${intro}\n\nIf it was not you, ignore this email — nothing has changed.\n\n${options.url}`,
  };
}

export function depositCredited(options: {
  name: string;
  amount: number;
  bonus: number;
  currency: string;
  network: string;
  url: string;
}): RenderedEmail {
  const site = settings.get('general.siteName');
  const bonusLine = options.bonus > 0 ? ` A bonus of ${dollars(options.bonus)} was added on top.` : '';
  const vars = {
    name: options.name,
    site,
    amount: dollars(options.amount),
    bonus: dollars(options.bonus),
    bonusLine,
    currency: options.currency,
    network: options.network,
  };
  const override = getEmailOverride('deposit-credited');
  const subject = override?.subject
    ? fill(override.subject, vars)
    : `${dollars(options.amount)} credited to your ${site} account`;
  const bodyHtml = override?.body
    ? `<p>${escape(fill(override.body, vars))}</p>`
    : `<p>Your ${escape(options.currency)} deposit on ${escape(options.network)} has confirmed and <strong>${dollars(options.amount)}</strong> is on your live balance.${escape(bonusLine)}</p>`;
  const bodyText = override?.body
    ? fill(override.body, vars)
    : `Your ${options.currency} deposit on ${options.network} has confirmed and ${dollars(options.amount)} is on your live balance.${bonusLine}`;
  return {
    subject,
    html: layout({ title: `Hello ${options.name},`, body: bodyHtml, action: { label: 'Open my wallet', url: options.url } }),
    text: `Hello ${options.name},\n\n${bodyText}\n\n${options.url}`,
  };
}

export function withdrawalUpdate(options: {
  name: string;
  status: string;
  amount: number;
  note: string | null;
  url: string;
}): RenderedEmail {
  const site = settings.get('general.siteName');
  const headline: Record<string, string> = {
    APPROVED: 'approved and queued for payment',
    PROCESSING: 'on its way to your wallet',
    COMPLETED: 'paid out',
    REJECTED: 'declined',
    CANCELLED: 'cancelled',
  };
  const what = headline[options.status] ?? `now ${options.status.toLowerCase()}`;
  const note = options.note ? `<p style="color:#94a3b8">${escape(options.note)}</p>` : '';
  const { subject, body: intro } = overridden(
    'withdrawal-completed',
    { name: options.name, site, amount: dollars(options.amount), what },
    `Your ${dollars(options.amount)} withdrawal is ${what}`,
    `Your withdrawal of ${dollars(options.amount)} from ${site} is ${what}.`,
  );
  return {
    subject,
    html: layout({
      title: `Hello ${options.name},`,
      body: `<p>${escape(intro)}</p>${note}`,
      action: { label: 'See the details', url: options.url },
    }),
    text: `Hello ${options.name},\n\n${intro}${options.note ? `\n\n${options.note}` : ''}\n\n${options.url}`,
  };
}

export function kycResult(options: {
  name: string;
  approved: boolean;
  reason: string | null;
  url: string;
}): RenderedEmail {
  const site = settings.get('general.siteName');
  // the rejection reason is per-submission, never fixed copy, so only the
  // approved branch is CMS-overridable — the rejection stays coded
  if (!options.approved) {
    return {
      subject: 'Your identity check needs another look',
      html: layout({
        title: `Hello ${options.name},`,
        body:
          `<p>We could not verify your account from the documents you sent.</p>` +
          (options.reason ? `<p style="color:#94a3b8">${escape(options.reason)}</p>` : '') +
          `<p>Send them again and we will look straight away.</p>`,
        action: { label: 'Send new documents', url: options.url },
      }),
      text: `Hello ${options.name},\n\nWe could not verify your account from the documents you sent.${options.reason ? `\n\n${options.reason}` : ''}\n\nSend them again: ${options.url}`,
    };
  }
  const { subject, body } = overridden(
    'kyc-approved',
    { name: options.name, site },
    'Your identity check passed',
    `Your documents have been checked and your ${site} account is now verified. Withdrawals are open.`,
  );
  return {
    subject,
    html: layout({
      title: `Hello ${options.name},`,
      body: `<p>${escape(body)}</p>`,
      action: { label: 'Open my account', url: options.url },
    }),
    text: `Hello ${options.name},\n\n${body}\n\n${options.url}`,
  };
}

export function tournamentResult(options: {
  name: string;
  tournament: string;
  place: number | null;
  prize: number;
  url: string;
}): RenderedEmail {
  const site = settings.get('general.siteName');
  const placed = options.place !== null;
  const ordinal = placed ? ordinalOf(options.place!) : null;
  // only the "you placed and won a prize" outcome is CMS copy — the "no
  // prize" outcome is the fallback branch and stays fixed
  if (options.prize <= 0) {
    return {
      subject: `${options.tournament} has finished`,
      html: layout({
        title: `Hello ${options.name},`,
        body: `<p>${escape(options.tournament)} has finished${placed ? ` and you came ${escape(ordinal!)}` : ''}. There is another one starting soon.</p>`,
        action: { label: 'See the final table', url: options.url },
      }),
      text: `Hello ${options.name},\n\n${options.tournament} has finished${placed ? ` and you came ${ordinal}` : ''}. There is another one starting soon on ${site}.\n\n${options.url}`,
    };
  }
  const { subject, body } = overridden(
    'tournament-result',
    { name: options.name, site, tournament: options.tournament, ordinal: ordinal!, prize: dollars(options.prize) },
    `You finished ${ordinal} in ${options.tournament}`,
    `You finished ${ordinal} in ${options.tournament} and ${dollars(options.prize)} has been paid to your live balance.`,
  );
  return {
    subject,
    html: layout({
      title: `Hello ${options.name},`,
      body: `<p>${escape(body)}</p>`,
      action: { label: 'See the final table', url: options.url },
    }),
    text: `Hello ${options.name},\n\n${body}\n\n${options.url}`,
  };
}

/** A one-off message an admin composes for a single trader, from User 360. */
export function adminMessage(options: { name: string; subject: string; body: string }): RenderedEmail {
  // the admin's own line breaks are the only structure this message has, so
  // they are kept rather than collapsed into one paragraph
  const paragraphs = options.body
    .split(/\n{2,}/)
    .map((p) => `<p>${escape(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
  return {
    subject: options.subject,
    html: layout({ title: `Hello ${options.name},`, body: paragraphs }),
    text: `Hello ${options.name},\n\n${options.body}`,
  };
}

/** 1st, 2nd, 3rd, 4th — including the teens, which break the pattern. */
export function ordinalOf(place: number): string {
  const tens = place % 100;
  if (tens >= 11 && tens <= 13) return `${place}th`;
  const suffix = ['th', 'st', 'nd', 'rd'][place % 10] ?? 'th';
  return `${place}${suffix}`;
}
