import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

/**
 * One write sent with an `Idempotency-Key` (spec 027, issue #16): the offline outbox replays a
 * write until it is acknowledged, and this is what makes a replay return the first result
 * instead of doing it again. Short-lived (TTL on `expiresAt`); nothing here is a record of the
 * person's data beyond the response it replays.
 */
@Schema({ collection: 'idempotency_keys', timestamps: true, versionKey: false })
export class IdempotencyKey {
  @Prop({ required: true }) userId!: string;
  @Prop({ required: true }) key!: string;
  /** Method, path and body hash: a key reused for a different write is refused. */
  @Prop({ required: true }) fingerprint!: string;
  @Prop({ required: true, enum: ['running', 'done'] }) state!: 'running' | 'done';
  /** Set once done: the HTTP status of a stored error, absent for success. */
  @Prop() errorStatus?: number;
  /** The response as JSON text, so any key shape is storable. Absent for an empty response. */
  @Prop() body?: string;
  @Prop({ required: true, type: Date }) startedAt!: Date;
  @Prop({ required: true, type: Date }) expiresAt!: Date;
}

export const IdempotencyKeySchema = SchemaFactory.createForClass(IdempotencyKey);
IdempotencyKeySchema.index({ userId: 1, key: 1 }, { unique: true });
IdempotencyKeySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
