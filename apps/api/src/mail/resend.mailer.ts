import type { Mailer, MailMessage } from './mailer';
import { MailError } from './mailer';

/**
 * Resend's HTTP API (https://resend.com/docs/api-reference/emails/send-email). Needs a verified
 * sending domain; see docs/runbooks/email.md. Errors carry the status only, never the body we
 * sent or the key.
 */
export class ResendMailer implements Mailer {
  readonly provider = 'resend' as const;

  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(message: MailMessage): Promise<void> {
    let response: Response;
    try {
      response = await this.fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: this.from, to: [message.to], subject: message.subject, text: message.text, html: message.html }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new MailError('Resend could not be reached.');
    }
    if (!response.ok) throw new MailError(`Resend refused the message (HTTP ${response.status}).`);
  }
}
