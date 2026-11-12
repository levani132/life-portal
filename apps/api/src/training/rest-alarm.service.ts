import { BadRequestException, Injectable, NotFoundException, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, type Model } from 'mongoose';
import { NotificationsService } from '../notifications/notifications.service';
import { WorkoutSession } from './training.schemas';

/** Furthest ahead an alarm may be set: the longest rest (900 s) plus room for +15 s taps. */
export const REST_ALARM_MAX_AHEAD_MS = 20 * 60 * 1000;

/**
 * Spec 025: a push when a rest between sets is over. The browser decides when (it alone knows
 * the superset rule, the ±15 s taps and Skip) and tells the server after every set and every
 * change; the server only keeps one timer per person and sends a `restOver` reminder when it
 * fires.
 *
 * The timer lives in this process's memory, on purpose: a rest lasts minutes, the free tier has
 * no job runner, and storing it would be persisting something derived. A restart loses a pending
 * alarm; the next set sets a new one. Nothing about it is ever written to Mongo.
 */
@Injectable()
export class RestAlarmService implements OnModuleInit, OnModuleDestroy {
  private readonly alarms = new Map<string, { sessionId: string; at: number; timer: ReturnType<typeof setTimeout> }>();

  constructor(
    @InjectModel(WorkoutSession.name) private readonly sessions: Model<WorkoutSession>,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit() {
    this.notifications.register({
      type: 'restOver',
      requires: ['training'],
      windowMs: 0,
      personal: true,
      // One per workout on the device: a newer rest replaces the older notification.
      collapseKey: (event) => event.targetId,
      url: () => '/training',
    });
  }

  onModuleDestroy() {
    for (const alarm of this.alarms.values()) clearTimeout(alarm.timer);
    this.alarms.clear();
  }

  /** Sets (or moves) the person's alarm for their open session; `null` cancels it. */
  async set(userId: string, sessionId: string, at: string | null, nowMs = Date.now()): Promise<void> {
    if (!isValidObjectId(sessionId)) throw new NotFoundException(`Session ${sessionId} not found`);
    const open = await this.sessions.exists({ _id: sessionId, userId, status: 'open' });
    if (!open) throw new NotFoundException(`No open session ${sessionId}`);
    if (at === null) {
      this.clear(userId);
      return;
    }
    const due = Date.parse(at);
    if (Number.isNaN(due)) throw new BadRequestException('at must be a date-time.');
    if (due > nowMs + REST_ALARM_MAX_AHEAD_MS) throw new BadRequestException('A rest alarm is at most 20 minutes ahead.');
    this.clear(userId);
    // A time already past means the rest is over: nothing to remind about.
    if (due <= nowMs) return;
    const timer = setTimeout(() => {
      if (this.alarms.get(userId)?.timer !== timer) return;
      this.alarms.delete(userId);
      void this.notifications.remind({ type: 'restOver', recipientId: userId, targetId: sessionId });
    }, due - nowMs);
    // Never keep the process alive (or a test runner) just for a reminder.
    timer.unref?.();
    this.alarms.set(userId, { sessionId, at: due, timer });
  }

  /** Cancels the person's alarm, e.g. when the workout is finished or discarded. */
  clear(userId: string): void {
    const alarm = this.alarms.get(userId);
    if (!alarm) return;
    clearTimeout(alarm.timer);
    this.alarms.delete(userId);
  }

  /** For tests and diagnostics: when the person's alarm fires, if one is set. */
  pending(userId: string): { sessionId: string; at: number } | undefined {
    const alarm = this.alarms.get(userId);
    return alarm ? { sessionId: alarm.sessionId, at: alarm.at } : undefined;
  }
}
