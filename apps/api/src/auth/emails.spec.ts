import { passwordResetEmail, verifyEmail } from './emails';

describe('auth emails', () => {
  const link = 'https://lifeportal.one/reset-password#token=abc';

  it('shows the wordmark and the icon from the web app the link points at', () => {
    const { html, text } = passwordResetEmail('a@example.com', 'Ana', link, 30);
    expect(html).toContain('>LifePortal<');
    expect(html).toContain('src="https://lifeportal.one/icon-192.png"');
    expect(html).toContain('href="https://lifeportal.one/reset-password#token=abc"');
    expect(text).toContain(link);
    expect(text).not.toContain('<');
  });

  it('leaves the image out when the link is not https, and still escapes what it is given', () => {
    const { html } = verifyEmail('a@example.com', '<b>Ana</b>', 'http://localhost:4200/verify-email#token=x', 24);
    expect(html).not.toContain('<img');
    expect(html).toContain('>LifePortal<');
    expect(html).toContain('&lt;b&gt;Ana&lt;/b&gt;');
  });
});
