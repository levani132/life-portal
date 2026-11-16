import { PROXY_HEADER, proxiedClientIp, webProxyMiddleware, type ProxiedRequest } from './web-proxy';

const SECRET = 'a'.repeat(40);

describe('the web app proxy proof (#29)', () => {
  it('takes the visitor address only with the right secret and a real IP', () => {
    expect(proxiedClientIp({ [PROXY_HEADER]: SECRET, 'x-real-ip': '203.0.113.7' }, SECRET)).toBe('203.0.113.7');
    expect(proxiedClientIp({ [PROXY_HEADER]: SECRET, 'x-real-ip': '2001:db8::1' }, SECRET)).toBe('2001:db8::1');
  });

  it('ignores a wrong, missing or literal secret, and anything that is not an IP', () => {
    expect(proxiedClientIp({ [PROXY_HEADER]: 'b'.repeat(40), 'x-real-ip': '203.0.113.7' }, SECRET)).toBeUndefined();
    expect(proxiedClientIp({ 'x-real-ip': '203.0.113.7' }, SECRET)).toBeUndefined();
    // Vercel leaves an unset variable as its literal name.
    expect(proxiedClientIp({ [PROXY_HEADER]: '$LP_PROXY_SECRET', 'x-real-ip': '203.0.113.7' }, SECRET)).toBeUndefined();
    expect(proxiedClientIp({ [PROXY_HEADER]: SECRET, 'x-real-ip': 'evil, 1.2.3.4' }, SECRET)).toBeUndefined();
  });

  it('never trusts anything when no secret is configured', () => {
    expect(proxiedClientIp({ [PROXY_HEADER]: '', 'x-real-ip': '203.0.113.7' }, undefined)).toBeUndefined();
  });

  it('sets req.ip, marks the request, and strips the secret', () => {
    const req = { headers: { [PROXY_HEADER]: SECRET, 'x-real-ip': '198.51.100.4' }, ip: '76.76.21.21' } as unknown as ProxiedRequest;
    const next = jest.fn();
    webProxyMiddleware(SECRET)(req, {} as never, next);
    expect(req.ip).toBe('198.51.100.4');
    expect(req.viaWebProxy).toBe(true);
    expect(req.headers[PROXY_HEADER]).toBeUndefined();
    expect(next).toHaveBeenCalled();
  });

  it('leaves a direct request alone, apart from removing a forged proof', () => {
    const req = { headers: { [PROXY_HEADER]: 'guess', 'x-real-ip': '198.51.100.4' }, ip: '192.0.2.10' } as unknown as ProxiedRequest;
    webProxyMiddleware(SECRET)(req, {} as never, jest.fn());
    expect(req.ip).toBe('192.0.2.10');
    expect(req.viaWebProxy).toBeUndefined();
    expect(req.headers[PROXY_HEADER]).toBeUndefined();
  });
});
