/** One message. `text` is always sent; `html` is the same content, escaped. */
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/**
 * Sends email (issue #27). Implementations must never log a message body: it can hold a
 * one-time link. Throws `MailError` when the provider refuses or cannot be reached.
 */
export interface Mailer {
  readonly provider: 'resend' | 'dev';
  send(message: MailMessage): Promise<void>;
}

export const MAILER = 'MAILER';

export class MailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MailError';
  }
}
