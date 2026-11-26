import { BadRequestException, ForbiddenException, Inject, Injectable, Logger, NotFoundException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { Types } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import type { AccountExport, DeleteAccountRequest } from '@life-portal/shared-types';
import { exportRecord, storageKeysIn } from '@life-portal/shared-domain';
import { CONFIG, type AppConfig } from '../config/configuration';
import { MAILER, type Mailer } from '../mail/mailer';
import { accountDeletedEmail } from '../auth/emails';
import { RATE_RULES } from '../auth/security/rate-limit-rules';
import { SecurityService, type RequestContext } from '../auth/security/security.service';
import { StorageService } from '../storage/storage.module';
import { ACCOUNT_PLAN, FILE_COLLECTIONS } from './account-plan';

type Row = Record<string, unknown>;
type Filter = Record<string, unknown>;

/** The few database calls this module makes, so a test can stand in for Mongo. */
export interface AccountStore {
  find(collection: string, filter: Filter, limit?: number): Promise<Row[]>;
  deleteMany(collection: string, filter: Filter): Promise<number>;
  updateMany(collection: string, filter: Filter, update: Filter, arrayFilters?: Filter[]): Promise<void>;
}
export const ACCOUNT_STORE = 'ACCOUNT_STORE';

/** What a copy made from a deleted account's post says in place of that person's name. */
export const FORMER_MEMBER = 'a former member';

/** Most records of one kind an export holds. Far above what a person logs in years. */
export const EXPORT_ROW_LIMIT = 50_000;

const ownedEntries = () =>
  Object.entries(ACCOUNT_PLAN).flatMap(([collection, rule]) =>
    rule.kind === 'owned' ? [{ collection, field: rule.field ?? 'userId', exported: rule.export !== false }] : [],
  );

/**
 * Leaving and taking your data (spec 038). The one module that reaches into every collection,
 * by name, following `ACCOUNT_PLAN`: deleting an account is the one job that is about all of
 * them at once (docs/DECISIONS.md, 2026-11-22).
 */
@Injectable()
export class AccountService {
  private readonly log = new Logger(AccountService.name);

  constructor(
    @Inject(ACCOUNT_STORE) private readonly store: AccountStore,
    private readonly storage: StorageService,
    private readonly security: SecurityService,
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(MAILER) private readonly mailer: Mailer | null,
  ) {}

  private async account(userId: string): Promise<Row> {
    if (!Types.ObjectId.isValid(userId)) throw new NotFoundException('Account not found.');
    const [user] = await this.store.find('users', { _id: new Types.ObjectId(userId) }, 1);
    if (!user) throw new NotFoundException('Account not found.');
    return user;
  }

  /** Everything the account owns, as stored, minus credentials and storage locations. */
  async export(userId: string, ctx: RequestContext = {}): Promise<AccountExport> {
    await this.security.hit(RATE_RULES.exportByUser, userId, ctx);
    const user = await this.account(userId);
    const data: AccountExport['data'] = {};
    const keys = new Set<string>();
    const put = (name: string, rows: Row[]) => {
      if ((FILE_COLLECTIONS as readonly string[]).includes(name)) storageKeysIn(rows, keys);
      if (rows.length) data[name] = rows.map((row) => exportRecord(row) as Row);
    };

    for (const { collection, field, exported } of ownedEntries()) {
      if (exported) put(collection, await this.store.find(collection, { [field]: userId }, EXPORT_ROW_LIMIT));
    }
    put('food_posts', await this.store.find('food_posts', { userId }, EXPORT_ROW_LIMIT));
    put('social_connections', await this.store.find('social_connections', { $or: [{ lowId: userId }, { highId: userId }] }, EXPORT_ROW_LIMIT));
    put('follows', await this.store.find('follows', { followerId: userId }, EXPORT_ROW_LIMIT));
    put('messages', await this.store.find('messages', { senderId: userId }, EXPORT_ROW_LIMIT));

    // Spec 040: the pages this person manages are theirs too: profile, posts, photos, follows.
    const pageIds = (await this.store.find('users', { kind: 'page', managers: userId })).map((row) => String(row['_id']));
    if (pageIds.length) {
      const ofPages = { userId: { $in: pageIds } };
      const add = (name: string, rows: Row[]) => {
        if ((FILE_COLLECTIONS as readonly string[]).includes(name)) storageKeysIn(rows, keys);
        if (rows.length) data[`pages.${name}`] = rows.map((row) => exportRecord(row) as Row);
      };
      for (const name of ['social_profiles', 'food_posts', 'post_media', 'post_comments']) add(name, await this.store.find(name, ofPages, EXPORT_ROW_LIMIT));
      add('follows', await this.store.find('follows', { followerId: { $in: pageIds } }, EXPORT_ROW_LIMIT));
      add('messages', await this.store.find('messages', { senderId: { $in: pageIds } }, EXPORT_ROW_LIMIT));
    }

    const files: AccountExport['files'] = [];
    if (this.storage.configured) {
      for (const key of keys) {
        files.push({ url: await this.storage.presignGet(key), kind: /\.(mp4|webm|mov)$/.test(key) ? 'video' : 'image' });
      }
    }
    const created = user['createdAt'];
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      account: {
        id: userId,
        email: String(user['email'] ?? ''),
        name: String(user['name'] ?? ''),
        ...(created instanceof Date ? { createdAt: created.toISOString() } : {}),
      },
      data,
      files,
      notes: [
        'Each list is named after where the records are stored and holds them as they are stored.',
        'Money is in whole cents, nutrients in whole milligrams, weights in grams, dates as YYYY-MM-DD.',
        'Passwords, sign-in sessions, access tokens and private links are not included.',
        'Messages are the ones you sent. What other people sent you is theirs.',
        'The links under "files" stop working after about an hour. Download the file again for new ones.',
      ],
    };
  }

  /**
   * Deletes the account and everything it owns. Safe to run again after a failure: files go
   * first (a file with no record could never be found again), the account row goes last.
   */
  async delete(userId: string, dto: DeleteAccountRequest, ctx: RequestContext = {}): Promise<{ success: true }> {
    await this.security.hit(RATE_RULES.deleteAccountByUser, userId, ctx);
    if (userId === this.config.developerUserId) {
      throw new ForbiddenException({ code: 'DEVELOPER_ACCOUNT', message: 'This account runs the app and cannot be deleted here.' });
    }
    const user = await this.account(userId);
    const email = String(user['email'] ?? '');
    const name = String(user['name'] ?? '');
    await this.confirm(user, dto, email);

    // Spec 040: the pages only this person manages go first, each erased like an account.
    const pages = await this.store.find('users', { kind: 'page', managers: userId });
    for (const page of pages) {
      if ((page['managers'] as unknown[] | undefined)?.length === 1) await this.erase(String(page['_id']));
      else await this.store.updateMany('users', { _id: page['_id'] }, { $pull: { managers: userId } });
    }
    await this.erase(userId);

    await this.security.record('account_deleted', ctx);
    if (this.mailer && email) {
      void this.mailer.send(accountDeletedEmail(email, name, this.config.webBaseUrl)).catch((error: unknown) => {
        this.log.warn(`Could not send the account-deleted email: ${(error as Error).name}`);
      });
    }
    return { success: true };
  }

  /**
   * Removes one account, a person's or a page's, and everything it owns, with no confirmation:
   * the caller has already decided. Files first, the account row last, so it can be run again.
   */
  async erase(userId: string): Promise<void> {
    // 1. Files.
    const keys = new Set<string>();
    for (const collection of FILE_COLLECTIONS) storageKeysIn(await this.store.find(collection, { userId }), keys);
    if (this.storage.configured) {
      const results = await Promise.all([...keys].map((key) => this.storage.delete(key)));
      if (results.includes(false)) {
        throw new ServiceUnavailableException({ code: 'FILES_NOT_DELETED', message: 'Some of your photos could not be deleted just now, so nothing was. Try again in a minute.' });
      }
    }

    // 2. Everything that can still act as the account.
    for (const collection of ['auth_sessions', 'mcp_oauth_credentials', 'ingest_tokens', 'push_devices', 'auth_email_tokens']) {
      await this.store.deleteMany(collection, { userId });
    }

    // 3. What other people's records hold of this account.
    const postIds = (await this.store.find('food_posts', { userId })).map((row) => String(row['_id']));
    if (postIds.length) {
      for (const collection of ['post_likes', 'post_comments', 'post_comment_likes', 'post_reports']) {
        await this.store.deleteMany(collection, { postId: { $in: postIds } });
      }
      await this.store.deleteMany('food_posts', { repostOf: { $in: postIds } });
      await this.store.deleteMany('feed_feedback', { kind: 'post', targetId: { $in: postIds } });
    }
    if (postIds.length) {
      // Copies other people saved keep their content and lose the name ("Shared by Ana").
      await this.store.updateMany(
        'foods',
        { sourceRef: { $in: postIds.map((id) => `post:${id}`) }, 'attribution.label': { $regex: '^Shared by ' } },
        { $set: { 'attribution.label': `Shared by ${FORMER_MEMBER}` } },
      );
    }
    // Likes other people gave this account's comments go with the comments.
    const commentIds = (await this.store.find('post_comments', { userId })).map((row) => String(row['_id']));
    if (commentIds.length) await this.store.deleteMany('post_comment_likes', { commentId: { $in: commentIds } });
    const formerAuthor = { $set: { 'sharedBy.label': FORMER_MEMBER }, $unset: { 'sharedBy.authorId': '' } };
    await this.store.updateMany('exercises', { 'sharedBy.authorId': userId }, formerAuthor);
    await this.store.updateMany('training_plans', { 'sharedBy.authorId': userId }, formerAuthor);
    await this.store.updateMany(
      'training_plans',
      { 'workouts.sharedBy.authorId': userId },
      { $set: { 'workouts.$[day].sharedBy.label': FORMER_MEMBER }, $unset: { 'workouts.$[day].sharedBy.authorId': '' } },
      [{ 'day.sharedBy.authorId': userId }],
    );
    await this.store.deleteMany('feed_feedback', { kind: 'author', targetId: userId });
    await this.store.updateMany('food_posts', { linkViewers: userId }, { $pull: { linkViewers: userId } });
    await this.store.deleteMany('food_posts', { userId });
    await this.store.deleteMany('social_connections', { $or: [{ lowId: userId }, { highId: userId }] });
    await this.store.deleteMany('follows', { $or: [{ followerId: userId }, { pageId: userId }] });
    const conversationIds = (await this.store.find('conversations', { memberIds: userId })).map((row) => String(row['_id']));
    if (conversationIds.length) {
      await this.store.deleteMany('messages', { conversationId: { $in: conversationIds } });
      await this.store.deleteMany('conversations', { memberIds: userId });
    }
    await this.store.updateMany('tournament_groups', { memberIds: userId }, { $pull: { memberIds: userId, results: { userId } } });

    // 4. Everything the account owns.
    for (const { collection, field } of ownedEntries()) await this.store.deleteMany(collection, { [field]: userId });

    // 5. The account.
    await this.store.deleteMany('users', { _id: new Types.ObjectId(userId) });
  }

  /** A password when the account has one; otherwise the email address typed out. */
  private async confirm(user: Row, dto: DeleteAccountRequest, email: string): Promise<void> {
    const hash = user['passwordHash'];
    if (typeof hash === 'string' && hash) {
      if (!dto.password || !(await bcrypt.compare(dto.password, hash))) {
        throw new UnauthorizedException({ code: 'WRONG_PASSWORD', message: 'That password is incorrect.' });
      }
      return;
    }
    if ((dto.confirmEmail ?? '').trim().toLowerCase() !== email.toLowerCase() || !email) {
      throw new BadRequestException({ code: 'CONFIRM_EMAIL', message: 'Type your account’s email address to confirm.' });
    }
  }
}
