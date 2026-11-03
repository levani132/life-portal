import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import webpush, { WebPushError } from 'web-push';
import type { PushPayload } from '@life-portal/shared-types';
import { CONFIG, type AppConfig } from '../config/configuration';

export interface PushTarget {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}
export type SendResult = 'ok' | 'gone' | 'failed';

/** Per-device limit. Sending is never awaited by the user's request, but it must still end. */
const TIMEOUT_MS = 5_000;
/** A social notification older than a day is not worth delivering. */
const TTL_SECONDS = 24 * 60 * 60;

/**
 * The only file that knows about `web-push` (research R1), so replacing it touches nothing
 * else. Encryption and VAPID signing happen inside the library.
 */
@Injectable()
export class PushSender {
  private readonly logger = new Logger(PushSender.name);
  constructor(@Inject(CONFIG) private readonly config: AppConfig) {}

  get configured(): boolean {
    return !!this.config.push;
  }
  get publicKey(): string | undefined {
    return this.config.push?.publicKey;
  }

  async send(target: PushTarget, payload: PushPayload): Promise<SendResult> {
    const push = this.config.push;
    if (!push) return 'failed';
    let timer: NodeJS.Timeout | undefined;
    try {
      // `timeout` below is a socket idle timeout; the race is the hard limit on the whole send.
      const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS);
      });
      await Promise.race([deadline, webpush.sendNotification(target, JSON.stringify(payload), {
        vapidDetails: {
          subject: push.subject,
          publicKey: push.publicKey,
          privateKey: push.privateKey,
        },
        TTL: TTL_SECONDS,
        timeout: TIMEOUT_MS,
        urgency: 'normal',
        // Lets the push service replace an undelivered older message with the same key.
        topic: topicFor(payload.tag),
      })]);
      return 'ok';
    } catch (error) {
      if (error instanceof WebPushError && [404, 410].includes(error.statusCode))
        return 'gone';
      // Never log the endpoint: it is a capability URL for that device.
      this.logger.warn(
        `Push delivery failed (${error instanceof WebPushError ? error.statusCode : 'network'})`,
      );
      return 'failed';
    } finally {
      clearTimeout(timer);
    }
  }
}

/** A Topic header is at most 32 URL-safe base64 characters. */
export function topicFor(tag: string): string {
  return createHash('sha256').update(tag).digest('base64url').slice(0, 32);
}
