import { MailError } from './mailer';
import { ResendMailer } from './resend.mailer';

describe('ResendMailer', () => {
  const message = { to: 'a@example.com', subject: 'S', text: 'secret link', html: '<p>secret link</p>' };

  it('posts the message with the key as a bearer token', async () => {
    const fetchImpl = jest.fn(async () => ({ ok: true, status: 200 }) as Response);
    await new ResendMailer('re_key', 'LP <no-reply@example.com>', fetchImpl as unknown as typeof fetch).send(message);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer re_key');
    expect(JSON.parse(init.body as string)).toMatchObject({ from: 'LP <no-reply@example.com>', to: ['a@example.com'], subject: 'S' });
  });

  it('reports a refusal by status only, without the body or the key', async () => {
    const fetchImpl = jest.fn(async () => ({ ok: false, status: 403 }) as Response);
    const sending = new ResendMailer('re_key', 'x@example.com', fetchImpl as unknown as typeof fetch).send(message);
    await expect(sending).rejects.toThrow(MailError);
    await expect(sending).rejects.toThrow('HTTP 403');
    await expect(sending).rejects.not.toThrow(/secret|re_key/);
  });
});
