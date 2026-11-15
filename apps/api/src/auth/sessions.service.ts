import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { AuthSessionInfo, RefreshRefusal } from '@life-portal/shared-types';
import { AuthSessionRecord, type SessionRevokeReason } from './schemas/auth-session.schema';
import { refreshFailure, type SessionState } from './session-rules';


/**
 * Sign-in sessions (issue #27). Every query is scoped by `userId` as well as the session id, so
 * one account can never see or end another's sessions.
 */
@Injectable()
export class SessionsService {
  constructor(@InjectModel(AuthSessionRecord.name) private readonly sessions: Model<AuthSessionRecord>) {}

  async create(input: { id: Types.ObjectId; userId: string; tokenHash: string; device: string; expiresAt: Date }) {
    const now = new Date();
    await this.sessions.create({
      _id: input.id,
      userId: input.userId,
      tokenHash: input.tokenHash,
      device: input.device.slice(0, 80),
      lastUsedAt: now,
      expiresAt: input.expiresAt,
    });
  }

  /**
   * Swaps the session's token for a new one, atomically: the filter requires the presented hash
   * to be the current one, so of two simultaneous refreshes with one token exactly one wins.
   * Returns `null` when it rotated; otherwise why not (`refreshFailure`). A replay revokes the session.
   */
  async rotate(input: {
    id: string;
    userId: string;
    presentedHash: string;
    nextHash: string;
    expiresAt: Date;
    now?: Date;
  }): Promise<RefreshRefusal | null> {
    const now = input.now ?? new Date();
    if (!Types.ObjectId.isValid(input.id)) return 'SESSION_ENDED';
    const filter = { _id: input.id, userId: input.userId };
    const rotated = await this.sessions.findOneAndUpdate(
      { ...filter, tokenHash: input.presentedHash, revokedAt: null, expiresAt: { $gt: now } },
      {
        $set: {
          tokenHash: input.nextHash,
          previousHash: input.presentedHash,
          rotatedAt: now,
          lastUsedAt: now,
          expiresAt: input.expiresAt,
        },
      },
      { projection: { _id: 1 } },
    );
    if (rotated) return null;

    const state = await this.sessions
      .findOne(filter)
      .select('revokedAt expiresAt previousHash rotatedAt')
      .lean<SessionState>();
    const failure = refreshFailure(state, input.presentedHash, now);
    if (failure.revoke) await this.revoke(input.userId, input.id, 'replay');
    return failure.code;
  }

  /** Whether an access token's session is still signed in. One indexed read per request. */
  async isLive(userId: string, id: string, now = new Date()): Promise<boolean> {
    if (!Types.ObjectId.isValid(id) || !Types.ObjectId.isValid(userId)) return false;
    const found = await this.sessions.exists({ _id: id, userId, revokedAt: null, expiresAt: { $gt: now } });
    return Boolean(found);
  }

  async list(userId: string, currentId: string, now = new Date()): Promise<AuthSessionInfo[]> {
    const rows = await this.sessions
      .find({ userId, revokedAt: null, expiresAt: { $gt: now } })
      .sort({ lastUsedAt: -1 })
      .select('device createdAt lastUsedAt')
      .lean<{ _id: Types.ObjectId; device: string; createdAt: Date; lastUsedAt: Date }[]>();
    return rows.map((row) => ({
      id: String(row._id),
      device: row.device,
      createdAt: row.createdAt.toISOString(),
      lastUsedAt: row.lastUsedAt.toISOString(),
      current: String(row._id) === currentId,
    }));
  }

  async revoke(userId: string, id: string, reason: SessionRevokeReason): Promise<void> {
    if (!Types.ObjectId.isValid(id)) return;
    await this.sessions.updateOne({ _id: id, userId, revokedAt: null }, { $set: { revokedAt: new Date(), revokedReason: reason } });
  }

  /** Ends one of your own sessions; another account's id is simply not found. */
  async revokeOwn(userId: string, id: string): Promise<void> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('That session was not found.');
    const result = await this.sessions.updateOne(
      { _id: id, userId, revokedAt: null },
      { $set: { revokedAt: new Date(), revokedReason: 'revoked' } },
    );
    if (result.matchedCount === 0) throw new NotFoundException('That session was not found.');
  }

  /** Ends every session of the account, except `keepId` when given. Returns how many ended. */
  async revokeAll(userId: string, reason: SessionRevokeReason, keepId?: string): Promise<number> {
    const filter: Record<string, unknown> = { userId, revokedAt: null };
    if (keepId && Types.ObjectId.isValid(keepId)) filter['_id'] = { $ne: new Types.ObjectId(keepId) };
    const result = await this.sessions.updateMany(filter, { $set: { revokedAt: new Date(), revokedReason: reason } });
    return result.modifiedCount;
  }
}
