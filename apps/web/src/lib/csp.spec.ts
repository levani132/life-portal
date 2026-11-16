import { buildCsp, cspHeaderName, originOnly } from './csp';

/** Issue #33: the policy and the storage origin check. */
const directive = (policy: string, name: string) =>
  policy.split('; ').find((part) => part.startsWith(`${name} `))?.slice(name.length + 1);

const base = { nonce: 'abc123', dev: false, apiUrl: '/api', storageOrigin: undefined };

describe('buildCsp', () => {
  it('allows scripts only by nonce, with strict-dynamic and no eval in production', () => {
    const scripts = directive(buildCsp(base), 'script-src');
    expect(scripts).toBe("'self' 'nonce-abc123' 'strict-dynamic'");
    expect(buildCsp(base)).not.toContain('unsafe-eval');
  });

  it('allows eval and the hot-reload socket only in development', () => {
    const policy = buildCsp({ ...base, dev: true });
    expect(directive(policy, 'script-src')).toContain("'unsafe-eval'");
    expect(directive(policy, 'connect-src')).toContain('ws:');
    expect(directive(buildCsp(base), 'connect-src')).toBe("'self'");
  });

  it('keeps the fixed restrictive directives', () => {
    const policy = buildCsp(base);
    expect(directive(policy, 'object-src')).toBe("'none'");
    expect(directive(policy, 'base-uri')).toBe("'self'");
    expect(directive(policy, 'frame-ancestors')).toBe("'none'");
    expect(directive(policy, 'form-action')).toBe("'self'");
    expect(directive(policy, 'default-src')).toBe("'self'");
  });

  it('adds the API origin only when the API is another site', () => {
    expect(directive(buildCsp({ ...base, apiUrl: 'https://api.example.com/api' }), 'connect-src')).toBe(
      "'self' https://api.example.com",
    );
    expect(directive(buildCsp({ ...base, apiUrl: undefined }), 'connect-src')).toBe("'self'");
  });

  it('adds the storage origin to uploads, images and media', () => {
    const policy = buildCsp({ ...base, storageOrigin: 'https://acct.r2.cloudflarestorage.com' });
    for (const name of ['connect-src', 'img-src', 'media-src']) {
      expect(directive(policy, name)).toContain('https://acct.r2.cloudflarestorage.com');
    }
    expect(directive(policy, 'script-src')).not.toContain('r2');
  });
});

describe('originOnly', () => {
  it('accepts a bare https origin, with or without a trailing slash or port', () => {
    expect(originOnly('https://acct.r2.cloudflarestorage.com')).toBe('https://acct.r2.cloudflarestorage.com');
    expect(originOnly(' https://acct.r2.cloudflarestorage.com/ ')).toBe('https://acct.r2.cloudflarestorage.com');
    expect(originOnly('https://host.example:8443')).toBe('https://host.example:8443');
  });

  it('accepts plain http only on this computer', () => {
    expect(originOnly('http://localhost:9000')).toBe('http://localhost:9000');
    expect(originOnly('http://127.0.0.1:9000')).toBe('http://127.0.0.1:9000');
    expect(originOnly('http://storage.example.com')).toBeUndefined();
  });

  it.each([
    undefined,
    '',
    'not a url',
    'https://host.example/bucket',
    'https://host.example/?x=1',
    'https://host.example/#x',
    'https://user:pw@host.example',
    'ftp://host.example',
    'javascript:alert(1)',
    'https://*.example.com',
    "https://host.example 'unsafe-inline'",
    'https://host.example; script-src *',
  ])('refuses %p', (value) => {
    expect(originOnly(value)).toBeUndefined();
  });
});

it('reports only until enforcement is switched on', () => {
  expect(cspHeaderName(false)).toBe('Content-Security-Policy-Report-Only');
  expect(cspHeaderName(true)).toBe('Content-Security-Policy');
});
