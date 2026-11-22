import type { MailMessage } from '../mail/mailer';

const escape = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

/** The wordmark as it is written in the app's header (apps/web/src/lib/brand.ts); the emails use it as the name too. */
const WORDMARK = 'LifePortal';

/**
 * The app icon, served by the web app the link points at. Mail apps that block images still show
 * the wordmark beside it, which is text. Nothing is attached and nothing is tracked.
 */
function iconUrl(link: string): string | null {
  try {
    const { origin, protocol } = new URL(link);
    return protocol === 'https:' ? `${origin}/icon-192.png` : null;
  } catch {
    return null;
  }
}

function layout(paragraphs: string[], link: { href: string; label: string }): string {
  const body = paragraphs.map((p) => `<p style="margin:0 0 16px">${escape(p)}</p>`).join('');
  const icon = iconUrl(link.href);
  const mark = icon
    ? `<td style="padding:0 10px 0 0;vertical-align:middle"><img src="${escape(icon)}" width="36" height="36" alt="" style="display:block;border:0;border-radius:9px"></td>`
    : '';
  const header = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px"><tr>${mark}<td style="vertical-align:middle;font-size:20px;font-weight:700;letter-spacing:-0.01em;color:#0c0e14">${WORDMARK}</td></tr></table>`;
  return `<!doctype html><html><body style="margin:0;padding:24px 12px;background:#f3f4f6;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;font-size:15px;line-height:1.5;color:#1a1a1a"><div style="max-width:480px;margin:0 auto;padding:28px 24px;background:#ffffff;border:1px solid #e5e7eb;border-radius:14px">${header}${body}<p style="margin:24px 0"><a href="${escape(link.href)}" style="display:inline-block;background:#0c0e14;color:#ffffff;padding:11px 18px;border-radius:9px;font-weight:600;text-decoration:none">${escape(link.label)}</a></p><p style="margin:0;color:#666666;font-size:13px;word-break:break-all">Or paste this link into your browser:<br>${escape(link.href)}</p></div></body></html>`;
}

/** The password-reset email (issue #27). The link carries the token in its fragment. */
export function passwordResetEmail(to: string, name: string, link: string, minutes: number): MailMessage {
  const lines = [
    `Hi ${name},`,
    `Someone asked to reset the password for your LifePortal account. If it was you, choose a new password with the link below. It works once and expires in ${minutes} minutes.`,
    "If it wasn't you, ignore this email: your password stays as it is.",
  ];
  return {
    to,
    subject: 'Reset your LifePortal password',
    text: `${lines.join('\n\n')}\n\n${link}\n`,
    html: layout(lines, { href: link, label: 'Choose a new password' }),
  };
}

/** The email-verification email (issue #27 S5). */
export function verifyEmail(to: string, name: string, link: string, hours: number): MailMessage {
  const lines = [
    `Hi ${name},`,
    `Confirm that this is your email address for LifePortal. The link expires in ${hours} hours.`,
    "If you didn't create a LifePortal account, ignore this email.",
  ];
  return {
    to,
    subject: 'Confirm your email for LifePortal',
    text: `${lines.join('\n\n')}\n\n${link}\n`,
    html: layout(lines, { href: link, label: 'Confirm email' }),
  };
}
