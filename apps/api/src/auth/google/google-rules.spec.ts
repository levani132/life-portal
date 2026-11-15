import { codeChallenge, isBindingHash, safeReturnTo, sha256 } from './google-rules';

describe('safeReturnTo (issue #28)', () => {
  it('keeps a path on the web app', () => {
    expect(safeReturnTo('/settings/security')).toBe('/settings/security');
    expect(safeReturnTo('/training?tab=plans')).toBe('/training?tab=plans');
  });

  it('turns anything that could leave the site into /', () => {
    for (const bad of ['https://evil.example', '//evil.example', '/\\evil.example', 'evil', '/a\nb', '/a\\b', '', 7, undefined, '/'.padEnd(201, 'a')]) {
      expect(safeReturnTo(bad)).toBe('/');
    }
  });
});

describe('PKCE and binding', () => {
  it('computes the RFC 7636 S256 challenge', () => {
    // The example from RFC 7636, appendix B.
    expect(codeChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('accepts only a SHA-256 hex digest as a binding hash', () => {
    expect(isBindingHash(sha256('x'))).toBe(true);
    expect(isBindingHash('x')).toBe(false);
    expect(isBindingHash(sha256('x').toUpperCase())).toBe(false);
  });
});
