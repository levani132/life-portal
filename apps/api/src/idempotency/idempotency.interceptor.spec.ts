import { BadRequestException, ConflictException, UnprocessableEntityException, type CallHandler, type ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';
import { FakeModel } from '../training/fake-model.testing';
import { IdempotencyInterceptor, STALE_RUNNING_MS } from './idempotency.interceptor';

const T0 = Date.parse('2026-11-14T12:00:00.000Z');

function fixture() {
  const keys = new FakeModel([['userId', 'key']]);
  const interceptor = new IdempotencyInterceptor(keys as never);
  let now = T0;
  interceptor.now = () => now;
  const headers: Record<string, string> = {};
  const call = (
    handler: () => unknown,
    { key = 'op-0001-abcdef', user = 'user-a', method = 'POST', url = '/api/things', body = { a: 1 } as unknown } = {},
  ) => {
    const request = { method, url, originalUrl: url, body, user: { userId: user }, headers: { 'idempotency-key': key } };
    const context = {
      getType: () => 'http',
      switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({ setHeader: (n: string, v: string) => (headers[n] = v) }) }),
    } as unknown as ExecutionContext;
    let runs = 0;
    const next: CallHandler = {
      handle: () => {
        runs++;
        try {
          return of(handler());
        } catch (error) {
          return throwError(() => error);
        }
      },
    };
    return { result: lastValueFrom(interceptor.intercept(context, next), { defaultValue: undefined }), runs: () => runs };
  };
  return { keys, interceptor, call, headers, tick: (ms: number) => (now += ms) };
}

describe('IdempotencyInterceptor (spec 027)', () => {
  it('runs a write once and replays its result for the same key', async () => {
    const f = fixture();
    let created = 0;
    const handler = () => ({ id: `row-${++created}` });
    const first = f.call(handler);
    expect(await first.result).toEqual({ id: 'row-1' });
    const again = f.call(handler);
    expect(await again.result).toEqual({ id: 'row-1' });
    expect(again.runs()).toBe(0);
    expect(created).toBe(1);
    expect(f.headers['Idempotent-Replayed']).toBe('true');
  });

  it('replays a refusal (4xx) the same way, without running again', async () => {
    const f = fixture();
    const refuse = () => {
      throw new BadRequestException('Reps are required.');
    };
    await expect(f.call(refuse).result).rejects.toBeInstanceOf(BadRequestException);
    const again = f.call(() => 'should not run');
    await expect(again.result).rejects.toMatchObject({ status: 400 });
    expect(again.runs()).toBe(0);
  });

  it('keeps nothing after a server error, so the write can be retried', async () => {
    const f = fixture();
    await expect(f.call(() => {
      throw new Error('database down');
    }).result).rejects.toThrow('database down');
    expect(f.keys.docs).toHaveLength(0);
    expect(await f.call(() => 'ok').result).toBe('ok');
  });

  it('refuses the same key for a different write', async () => {
    const f = fixture();
    await f.call(() => 'first').result;
    await expect(f.call(() => 'second', { body: { a: 2 } }).result).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(f.call(() => 'third', { url: '/api/other' }).result).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('keeps keys per user', async () => {
    const f = fixture();
    expect(await f.call(() => 'a', { user: 'user-a' }).result).toBe('a');
    expect(await f.call(() => 'b', { user: 'user-b' }).result).toBe('b');
  });

  it('answers 409 while the first attempt is running, and takes over a stale one', async () => {
    const f = fixture();
    f.keys.docs.push({
      _id: undefined as never,
      userId: 'user-a',
      key: 'op-0001-abcdef',
      fingerprint: '',
      state: 'running',
      startedAt: new Date(T0),
      expiresAt: new Date(T0 + 1),
    });
    // Same fingerprint as the call below.
    const probe = f.call(() => 'x', { key: 'probe-key-0001' });
    await probe.result;
    f.keys.docs[0]['fingerprint'] = f.keys.docs[1]['fingerprint'];
    await expect(f.call(() => 'y').result).rejects.toBeInstanceOf(ConflictException);
    f.tick(STALE_RUNNING_MS + 1);
    const taken = f.call(() => 'z');
    expect(await taken.result).toBe('z');
    expect(taken.runs()).toBe(1);
  });

  it('ignores reads, missing keys and anonymous requests, and refuses a malformed key', async () => {
    const f = fixture();
    expect(await f.call(() => 'read', { method: 'GET' }).result).toBe('read');
    expect(await f.call(() => 'anon', { user: '' }).result).toBe('anon');
    expect(f.keys.docs).toHaveLength(0);
    expect(() => f.call(() => 'bad', { key: 'short' })).toThrow(UnprocessableEntityException);
  });
});
