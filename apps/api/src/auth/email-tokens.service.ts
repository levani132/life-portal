import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { randomBytes } from 'node:crypto';
import { Model } from 'mongoose';
import { EmailToken } from './schemas/email-token.schema';
import { tokenHash } from './session-rules';

type Purpose = EmailToken['purpose'];

/** Issues and spends one-time email tokens (issue #27). The token itself is never stored. */
@Injectable()
export class EmailTokensService {
  constructor(@InjectModel(EmailToken.name) private readonly tokens: Model<EmailToken>) {}

  /** Replaces any unused token of this purpose for the user with a new one. */
  async issue(userId: string, purpose: Purpose, ttlMs: number, email?: string): Promise<string> {
    const now = new Date();
    await this.tokens.updateMany({ userId, purpose, usedAt: null }, { $set: { usedAt: now } });
    const token = randomBytes(32).toString('base64url');
    await this.tokens.create({
      purpose,
      userId,
      email,
      tokenHash: tokenHash(token),
      createdAt: now,
      expiresAt: new Date(now.getTime() + ttlMs),
    });
    return token;
  }

  /** The live token's row, without spending it. */
  async peek(token: string, purpose: Purpose, now = new Date()) {
    if (!token) return null;
    return this.tokens
      .findOne({ tokenHash: tokenHash(token), purpose, usedAt: null, expiresAt: { $gt: now } })
      .lean<{ userId: string; email?: string }>();
  }

  /** Spends the token. Of two concurrent calls with one token, exactly one gets the row. */
  async consume(token: string, purpose: Purpose, now = new Date()) {
    if (!token) return null;
    return this.tokens
      .findOneAndUpdate(
        { tokenHash: tokenHash(token), purpose, usedAt: null, expiresAt: { $gt: now } },
        { $set: { usedAt: now } },
        { projection: { userId: 1, email: 1 } },
      )
      .lean<{ userId: string; email?: string }>();
  }

  /** Voids every unused token of this purpose for the user. */
  async voidAll(userId: string, purpose: Purpose): Promise<void> {
    await this.tokens.updateMany({ userId, purpose, usedAt: null }, { $set: { usedAt: new Date() } });
  }
}
