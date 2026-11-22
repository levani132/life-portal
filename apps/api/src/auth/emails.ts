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

function layout(paragraphs: string[], link?: { href: string; label: string }, iconFrom?: string): string {
  const body = paragraphs.map((p) => `<p style="margin:0 0 16px">${escape(p)}</p>`).join('');
  const icon = iconUrl(link?.href ?? iconFrom ?? '');
  const mark = icon
    ? `<td style="padding:0 10px 0 0;vertical-align:middle"><img src="${escape(icon)}" width="36" height="36" alt="" style="display:block;border:0;border-radius:9px"></td>`
    : '';
  const header = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px"><tr>${mark}<td style="vertical-align:middle;font-size:20px;font-weight:700;letter-spacing:-0.01em;color:#0c0e14">${WORDMARK}</td></tr></table>`;
  const action = link
    ? `<p style="margin:24px 0"><a href="${escape(link.href)}" style="display:inline-block;background:#0c0e14;color:#ffffff;padding:11px 18px;border-radius:9px;font-weight:600;text-decoration:none">${escape(link.label)}</a></p><p style="margin:0;color:#666666;font-size:13px;word-break:break-all">Or paste this link into your browser:<br>${escape(link.href)}</p>`
    : '';
  return `<!doctype html><html><body style="margin:0;padding:24px 12px;background:#f3f4f6;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;font-size:15px;line-height:1.5;color:#1a1a1a"><div style="max-width:480px;margin:0 auto;padding:28px 24px;background:#ffffff;border:1px solid #e5e7eb;border-radius:14px">${header}${body}${action}</div></body></html>`;
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

/** Sent once an account is deleted (spec 038), so a deletion nobody asked for is noticed. */
export function accountDeletedEmail(to: string, name: string, webOrigin?: string): MailMessage {
  const lines = [
    `Hi ${name},`,
    'Your LifePortal account and everything in it have been deleted, as you asked. This cannot be undone.',
    "If you didn't ask for this, reply to this email straight away.",
  ];
  return {
    to,
    subject: 'Your LifePortal account was deleted',
    text: `${lines.join('\n\n')}\n`,
    html: layout(lines, undefined, webOrigin),
  };
}

/** Tells the developer a post waits for review (spec 039). It says nothing about the post. */
export function reviewNeededEmail(to: string, link: string): MailMessage {
  const lines = ['A post is waiting for your review: it was reported, or its photo did not pass the automatic check.', 'Until you decide, a held post is hidden from everyone but its author.'];
  return {
    to,
    subject: 'LifePortal: a post needs review',
    text: `${lines.join('\n\n')}\n\n${link}\n`,
    html: layout(lines, { href: link, label: 'Open the review queue' }),
  };
}

/** `support@` on the domain mail is sent from, for the "write to us" line. */
export function supportAddress(from: string | undefined): string | undefined {
  const domain = /@([^@\s>]+)>?\s*$/.exec(from ?? '')?.[1];
  return domain ? `support@${domain}` : undefined;
}

const appeal = (support?: string) =>
  support ? `If you think this is a mistake, write to ${support} from this address.` : 'If you think this is a mistake, reply to this email.';

/** Tells an author the reviewer removed their post (spec 039). Only their own title is quoted. */
export function postRemovedEmail(to: string, name: string, post: { title: string; day: string }, rulesLink: string, support?: string): MailMessage {
  const which = post.title.trim() ? `Your post "${post.title.trim().slice(0, 80)}" from ${post.day}` : `Your post from ${post.day}`;
  const lines = [`Hi ${name},`, `${which} was removed because it breaks the Community Rules. Its text and photos have been deleted.`, appeal(support)];
  return {
    to,
    subject: 'LifePortal: your post was removed',
    text: `${lines.join('\n\n')}\n\n${rulesLink}\n`,
    html: layout(lines, { href: rulesLink, label: 'Read the Community Rules' }),
  };
}

/** Tells a person their account was suspended (spec 039). */
export function accountSuspendedEmail(to: string, name: string, rulesLink: string | undefined, support?: string): MailMessage {
  const lines = [
    `Hi ${name},`,
    'Your LifePortal account has been suspended for breaking the Community Rules. You are signed out on every device and cannot sign in, and what you posted is not shown to anyone. Nothing has been deleted.',
    appeal(support),
  ];
  return {
    to,
    subject: 'LifePortal: your account was suspended',
    text: `${lines.join('\n\n')}\n${rulesLink ? `\n${rulesLink}\n` : ''}`,
    html: layout(lines, rulesLink ? { href: rulesLink, label: 'Read the Community Rules' } : undefined),
  };
}
