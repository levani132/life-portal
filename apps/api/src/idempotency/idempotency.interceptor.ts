import {
  ConflictException,
  HttpException,
  Injectable,
  Optional,
  UnprocessableEntityException,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { createHash } from 'node:crypto';
import type { Model } from 'mongoose';
import { from, lastValueFrom, type Observable } from 'rxjs';
import { syncAgeBucket, syncRefusalKey } from '@life-portal/shared-domain';
import { SyncHealthService } from '../sync-health/sync-health.service';
import { IdempotencyKey } from './idempotency.schema';

export const IDEMPOTENCY_HEADER = 'idempotency-key';
/** Issue #22: seconds the write waited on the device. Only ever bucketed, never stored. */
export const QUEUED_AGE_HEADER = 'x-queued-age';
const KEY_PATTERN = /^[A-Za-z0-9_:-]{8,100}$/;
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
/** A replay window comfortably longer than an offline outbox keeps retrying. */
export const IDEMPOTENCY_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** A "running" key older than this belongs to a request that died; the next attempt takes over. */
export const STALE_RUNNING_MS = 2 * 60 * 1000;
/** Responses larger than this are not stored; the write still happened once. */
const MAX_BODY_CHARS = 512 * 1024;

type Row = IdempotencyKey & { _id: unknown };
interface HttpRequest {
  method: string;
  originalUrl?: string;
  url: string;
  body?: unknown;
  headers: Record<string, string | string[] | undefined>;
  user?: { userId?: string };
}

const isDuplicateKey = (error: unknown) => (error as { code?: number } | null)?.code === 11000;

/**
 * Makes any authenticated write retry-safe when the client sends `Idempotency-Key` (spec 027).
 * Without the header nothing changes, so existing clients and the token-auth ingest route are
 * untouched. With it:
 *
 * - the first request with a key runs and its result is stored (success, or a 4xx refusal other
 *   than 409);
 * - a repeat with the same key and the same method, path and body gets that result back
 *   without running again, with `Idempotent-Replayed: true`;
 * - the same key for a different write answers 422 `IDEMPOTENCY_KEY_REUSED`;
 * - a repeat while the first is still running answers 409 `IDEMPOTENCY_IN_PROGRESS`, which the
 *   outbox treats as "try again shortly";
 * - a 409 conflict, a 5xx or a crash stores nothing, so the write can be retried (a conflict is
 *   about the state at the time, which the person may change: spec 028).
 *
 * Keys are per user: one person's key never matches another's.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  /** The clock, replaceable in tests. */
  now: () => number = Date.now;

  constructor(
    @InjectModel(IdempotencyKey.name) private readonly keys: Model<IdempotencyKey>,
    /** Issue #22: content-free counters of what keyed writes met. Optional so unit tests skip it. */
    @Optional() private readonly health?: SyncHealthService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const http = context.switchToHttp();
    const request = http.getRequest<HttpRequest>();
    const raw = request.headers[IDEMPOTENCY_HEADER];
    const key = Array.isArray(raw) ? raw[0] : raw;
    const userId = request.user?.userId;
    if (!key || !userId || !WRITE_METHODS.has(request.method)) return next.handle();
    if (!KEY_PATTERN.test(key)) {
      throw new UnprocessableEntityException({
        code: 'IDEMPOTENCY_KEY_INVALID',
        message: 'Idempotency-Key must be 8 to 100 letters, digits, "_", ":" or "-".',
      });
    }
    const response = http.getResponse<{ setHeader(name: string, value: string): void }>();
    const age = request.headers[QUEUED_AGE_HEADER];
    const tally = { replayed: false };
    return from(this.counted(tally, Array.isArray(age) ? age[0] : age, this.run(userId, key, fingerprintOf(request), next, response, tally)));
  }

  /**
   * Issue #22: counts what the write met — replayed, refused (by code) and how long it waited —
   * after the answer is decided. A replayed refusal counts as a replay, not a second refusal.
   */
  private async counted(tally: { replayed: boolean }, age: string | undefined, answer: Promise<unknown>): Promise<unknown> {
    let refusal: string | undefined;
    try {
      return await answer;
    } catch (error) {
      if (error instanceof HttpException && error.getStatus() < 500 && !tally.replayed) {
        const body = error.getResponse();
        refusal = syncRefusalKey(error.getStatus(), typeof body === 'object' && body ? (body as { code?: unknown }).code : undefined);
      }
      throw error;
    } finally {
      this.health?.record({ replayed: tally.replayed, refusal, age: syncAgeBucket(age) }, new Date(this.now()));
    }
  }

  private async run(
    userId: string,
    key: string,
    fingerprint: string,
    next: CallHandler,
    response: { setHeader(name: string, value: string): void },
    tally: { replayed: boolean } = { replayed: false },
  ): Promise<unknown> {
    const claimed = await this.claim(userId, key, fingerprint);
    if (claimed !== true) {
      tally.replayed = true;
      response.setHeader('Idempotent-Replayed', 'true');
      return replay(claimed);
    }
    try {
      const result = await lastValueFrom(next.handle(), { defaultValue: undefined });
      await this.finish(userId, key, { body: serialise(result) });
      return result;
    } catch (error) {
      // A 409 is decided by the state at the time (another workout open, a plan day changed): the
      // person resolves it and sends the same write again, so it is released, not replayed
      // (spec 028). Other refusals are about the write itself and are replayed.
      if (error instanceof HttpException && error.getStatus() < 500 && error.getStatus() !== 409) {
        await this.finish(userId, key, { errorStatus: error.getStatus(), body: serialise(error.getResponse()) });
      } else {
        await this.keys.deleteOne({ userId, key, state: 'running' });
      }
      throw error;
    }
  }

  /** `true` when this request owns the key and must run; otherwise the stored row to replay. */
  private async claim(userId: string, key: string, fingerprint: string): Promise<true | Row> {
    const now = this.now();
    try {
      await this.keys.create({
        userId,
        key,
        fingerprint,
        state: 'running',
        startedAt: new Date(now),
        expiresAt: new Date(now + IDEMPOTENCY_TTL_MS),
      });
      return true;
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
    }
    const existing = await this.keys.findOne({ userId, key }).lean<Row>();
    if (!existing) return this.claim(userId, key, fingerprint);
    if (existing.fingerprint !== fingerprint) {
      throw new UnprocessableEntityException({
        code: 'IDEMPOTENCY_KEY_REUSED',
        message: 'This Idempotency-Key was already used for a different request.',
      });
    }
    if (existing.state === 'done') return existing;
    // Still running. If the first attempt died without cleaning up, take it over.
    if (now - new Date(existing.startedAt).getTime() > STALE_RUNNING_MS) {
      const taken = await this.keys.updateOne(
        { userId, key, state: 'running', startedAt: existing.startedAt },
        { $set: { startedAt: new Date(now), expiresAt: new Date(now + IDEMPOTENCY_TTL_MS) } },
      );
      if (taken.matchedCount) return true;
    }
    throw new ConflictException({
      code: 'IDEMPOTENCY_IN_PROGRESS',
      message: 'This change is still being saved. Try again in a moment.',
    });
  }

  private async finish(userId: string, key: string, outcome: { errorStatus?: number; body?: string }) {
    if (outcome.body !== undefined && outcome.body.length > MAX_BODY_CHARS) {
      // Too large to keep: drop the key rather than replay a truncated answer.
      await this.keys.deleteOne({ userId, key });
      return;
    }
    await this.keys.updateOne(
      { userId, key },
      {
        $set: {
          state: 'done',
          ...(outcome.errorStatus !== undefined ? { errorStatus: outcome.errorStatus } : {}),
          ...(outcome.body !== undefined ? { body: outcome.body } : {}),
        },
      },
    );
  }
}

function fingerprintOf(request: HttpRequest): string {
  const path = request.originalUrl ?? request.url;
  return createHash('sha256')
    .update(`${request.method}\n${path}\n${JSON.stringify(request.body ?? null)}`)
    .digest('hex');
}

/** JSON text after `toJSON` transforms, exactly what the client received. */
function serialise(value: unknown): string | undefined {
  return value === undefined ? undefined : JSON.stringify(value);
}

function replay(row: Row): unknown {
  const body = row.body === undefined ? undefined : (JSON.parse(row.body) as unknown);
  if (row.errorStatus !== undefined) throw new HttpException(body as string | Record<string, unknown>, row.errorStatus);
  return body;
}
