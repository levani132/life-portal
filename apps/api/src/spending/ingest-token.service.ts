import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { randomBytes } from 'node:crypto';
import * as bcrypt from 'bcryptjs';
import { Model } from 'mongoose';
import { isValidObjectId } from 'mongoose';
import type { IngestTokenCreated, IngestTokenSummary } from '@life-portal/shared-types';
import { IngestToken } from './spending.schemas';

/** Matches what `auth.service.ts` uses for passwords and refresh tokens. */
const BCRYPT_ROUNDS = 12;

/**
 * Presented as `lp_<tokenId>_<secret>`.
 *
 * The row id travels with the secret on purpose. bcrypt is deliberately slow, so comparing a
 * presented token against *every* stored hash would cost ~100 ms each; naming the row means
 * exactly one comparison however many tokens exist.
 */
const TOKEN_PATTERN = /^lp_([0-9a-fA-F]{24})_([A-Za-z0-9_-]{20,})$/;

@Injectable()
export class IngestTokenService {
  constructor(@InjectModel(IngestToken.name) private readonly tokens: Model<IngestToken>) {}

  async list(userId: string): Promise<IngestTokenSummary[]> {
    const rows = await this.tokens.find({ userId }).sort({ createdAt: -1 });
    return rows.map((r) => r.toJSON() as unknown as IngestTokenSummary);
  }

  /**
   * Mints a token and returns its plain value **once**.
   *
   * Only the hash is stored, so this response is the single moment the secret exists anywhere
   * outside the owner's phone. Losing it means minting another, which is the intended trade.
   */
  async create(userId: string, label: string, expiresAt: string): Promise<IngestTokenCreated> {
    const secret = randomBytes(32).toString('base64url');
    const created = await this.tokens.create({
      userId,
      label,
      expiresAt,
      secretHash: await bcrypt.hash(secret, BCRYPT_ROUNDS),
    });
    const summary = created.toJSON() as unknown as IngestTokenSummary;
    return { ...summary, token: `lp_${String(created._id)}_${secret}` };
  }

  /** Revokes rather than deletes, so a withdrawn credential stays auditable. */
  async revoke(userId: string, id: string, today: string): Promise<IngestTokenSummary> {
    if (!isValidObjectId(id)) throw new NotFoundException(`Token ${id} not found`);
    const updated = await this.tokens.findOneAndUpdate(
      { _id: id, userId },
      { $set: { revokedAt: today } },
      { new: true },
    );
    if (!updated) throw new NotFoundException(`Token ${id} not found`);
    return updated.toJSON() as unknown as IngestTokenSummary;
  }

  /**
   * The owner a presented token belongs to, or `null`.
   *
   * This is the whole of the multi-user story for ingest: a message can only ever reach the
   * account whose token signed it, so nothing about the message itself has to identify anyone.
   *
   * `today` is passed in rather than read from the clock so expiry is testable (principle V).
   */
  async verify(
    presented: string,
    today: string,
  ): Promise<{ userId: string; tokenId: string } | null> {
    const match = TOKEN_PATTERN.exec(presented.trim());
    if (!match) return null;

    const [, tokenId, secret] = match;
    const row = await this.tokens.findById(tokenId);
    if (!row || row.revokedAt) return null;
    if (row.expiresAt < today) return null;
    if (!(await bcrypt.compare(secret, row.secretHash))) return null;

    return { userId: row.userId, tokenId };
  }

  /**
   * Stamped after a submission is accepted, not on every attempt.
   *
   * It is what the setup screen reads to say "capture is working", so it must mean a message
   * actually landed rather than that something once presented a credential.
   */
  async markUsed(tokenId: string, at: string): Promise<void> {
    await this.tokens.updateOne({ _id: tokenId }, { $set: { lastUsedAt: at } });
  }
}
