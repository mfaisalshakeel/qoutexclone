import { settings } from './settings.js';

/**
 * The HTML the platform sends.
 *
 * Plain tables and inline styles, because that is what mail clients render
 * reliably, and a text alternative for every one of them. The content is
 * written here rather than in the database so a template can never be missing;
 * the CMS in a later phase overrides the copy, not the structure.
 */

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

function escape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

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
  return {
    subject: `Confirm your ${site} email address`,
    html: layout({
      title: `Hello ${escape(options.name)},`,
      body: `<p>Confirm this address to finish setting up your ${escape(site)} account. The link works for the next ${options.hours} hours.</p>`,
      action: { label: 'Confirm my email', url: options.url },
    }),
    text: `Hello ${options.name},\n\nConfirm this address to finish setting up your ${site} account:\n${options.url}\n\nThe link works for the next ${options.hours} hours.`,
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
  const when = options.at.toUTCString();
  return {
    subject: `New sign-in to your ${site} account`,
    html: layout({
      title: `Hello ${escape(options.name)},`,
      body:
        `<p>Your account was signed in to from a device we have not seen before.</p>` +
        `<p style="color:#94a3b8"><strong style="color:#e2e8f0">${escape(options.device)}</strong><br>IP ${escape(options.ip)}<br>${escape(when)}</p>` +
        `<p>If that was you, there is nothing to do. If it was not, change your password and sign the other devices out.</p>`,
      action: { label: 'Review my devices', url: options.url },
    }),
    text: `Hello ${options.name},\n\nYour account was signed in to from a new device.\n\n${options.device}\nIP ${options.ip}\n${when}\n\nIf that was not you, change your password and sign the other devices out: ${options.url}`,
  };
}

export function twoFactorChanged(options: { name: string; enabled: boolean; url: string }): RenderedEmail {
  const site = settings.get('general.siteName');
  return {
    subject: options.enabled
      ? `Two-factor authentication is on for your ${site} account`
      : `Two-factor authentication was turned off`,
    html: layout({
      title: `Hello ${escape(options.name)},`,
      body: options.enabled
        ? `<p>Two-factor authentication is now switched on. You will need a code from your authenticator app each time you sign in.</p>`
        : `<p>Two-factor authentication was switched off on your account. If that was not you, turn it back on and change your password now.</p>`,
      action: { label: 'Open security settings', url: options.url },
    }),
    text: options.enabled
      ? `Hello ${options.name},\n\nTwo-factor authentication is now switched on for your ${site} account.\n\n${options.url}`
      : `Hello ${options.name},\n\nTwo-factor authentication was switched off on your ${site} account. If that was not you, turn it back on and change your password: ${options.url}`,
  };
}
