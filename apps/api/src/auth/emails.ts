import type { MailMessage } from '../mail/mailer';

const escape = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

function layout(paragraphs: string[], link: { href: string; label: string }): string {
  const body = paragraphs.map((p) => `<p style="margin:0 0 16px">${escape(p)}</p>`).join('');
  return `<!doctype html><html><body style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#1a1a1a;max-width:480px;margin:24px auto;padding:0 16px">${body}<p style="margin:24px 0"><a href="${escape(link.href)}" style="background:#1a1a1a;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">${escape(link.label)}</a></p><p style="margin:0;color:#666;font-size:13px">Or paste this link into your browser:<br>${escape(link.href)}</p></body></html>`;
}

/** The password-reset email (issue #27). The link carries the token in its fragment. */
export function passwordResetEmail(to: string, name: string, link: string, minutes: number): MailMessage {
  const lines = [
    `Hi ${name},`,
    `Someone asked to reset the password for your Life Portal account. If it was you, choose a new password with the link below. It works once and expires in ${minutes} minutes.`,
    "If it wasn't you, ignore this email: your password stays as it is.",
  ];
  return {
    to,
    subject: 'Reset your Life Portal password',
    text: `${lines.join('\n\n')}\n\n${link}\n`,
    html: layout(lines, { href: link, label: 'Choose a new password' }),
  };
}

/** The email-verification email (issue #27 S5). */
export function verifyEmail(to: string, name: string, link: string, hours: number): MailMessage {
  const lines = [
    `Hi ${name},`,
    `Confirm that this is your email address for Life Portal. The link expires in ${hours} hours.`,
    "If you didn't create a Life Portal account, ignore this email.",
  ];
  return {
    to,
    subject: 'Confirm your email for Life Portal',
    text: `${lines.join('\n\n')}\n\n${link}\n`,
    html: layout(lines, { href: link, label: 'Confirm email' }),
  };
}
