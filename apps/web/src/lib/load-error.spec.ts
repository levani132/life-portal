import { ApiError, NetworkError } from './api';
import { endsSession, loadErrorKind, loadErrorMessage, retriesOnItsOwn, retryDelayMs } from './load-error';

describe('loadErrorKind (issue #34)', () => {
  it('tells offline from a request that got no answer', () => {
    expect(loadErrorKind(new NetworkError(undefined, true), true)).toBe('offline');
    expect(loadErrorKind(new NetworkError(), false)).toBe('offline');
    expect(loadErrorKind(new NetworkError(), true)).toBe('unreachable');
  });

  it('tells a server error, an ended session and any other answer apart', () => {
    expect(loadErrorKind(new ApiError('boom', 502), true)).toBe('server');
    expect(loadErrorKind(new ApiError('Sign in again.', 401), true)).toBe('session');
    expect(loadErrorKind(new ApiError('Not allowed.', 403), true)).toBe('other');
    expect(loadErrorKind(new Error('?'), true)).toBe('other');
  });

  it('never calls a server or session failure "No connection"', () => {
    for (const kind of ['server', 'session', 'unreachable'] as const) {
      expect(loadErrorMessage(kind, new NetworkError())).not.toMatch(/no connection/i);
    }
    expect(loadErrorMessage('other', new ApiError('Not allowed.', 403))).toBe('Not allowed.');
  });

  it('retries only what may answer differently next time', () => {
    expect(retriesOnItsOwn('unreachable')).toBe(true);
    expect(retriesOnItsOwn('server')).toBe(true);
    expect(retriesOnItsOwn('offline')).toBe(false);
    expect(retriesOnItsOwn('session')).toBe(false);
    expect(retriesOnItsOwn('other')).toBe(false);
  });

  it('backs off and then stops', () => {
    expect([1, 2, 3, 4, 5].map(retryDelayMs)).toEqual([2000, 4000, 8000, 16000, 30000]);
    expect(retryDelayMs(6)).toBeUndefined();
  });
});

describe('endsSession (issue #34)', () => {
  it('ends the session only on a refusal, never on an outage', () => {
    expect(endsSession(new ApiError('Sign in again.', 401))).toBe(true);
    expect(endsSession(new ApiError('Forbidden', 403))).toBe(true);
    expect(endsSession(new ApiError('Bad gateway', 502))).toBe(false);
    expect(endsSession(new ApiError('Internal server error', 500))).toBe(false);
    expect(endsSession(new ApiError('Too many requests', 429))).toBe(false);
    expect(endsSession(new NetworkError())).toBe(false);
  });
});

