import { Types } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import type { AppConfig } from '../config/configuration';
import type { Mailer, MailMessage } from '../mail/mailer';
import type { SecurityService } from '../auth/security/security.service';
import type { StorageService } from '../storage/storage.module';
import { AccountService, type AccountStore } from './account.service';

type Row = Record<string, unknown>;

/** Reads `a.b.c`, looking inside arrays on the way the way Mongo does. */
function reach(value: unknown, path: string[]): unknown[] {
  if (!path.length) return Array.isArray(value) ? value : [value];
  if (Array.isArray(value)) return value.flatMap((item) => reach(item, path));
  if (value && typeof value === 'object') return reach((value as Row)[path[0]], path.slice(1));
  return [];
}
const same = (a: unknown, b: unknown) => a !== undefined && String(a) === String(b);

function matches(row: unknown, filter: Row): boolean {
  return Object.entries(filter).every(([field, want]) => {
    if (field === '$or') return (want as Row[]).some((one) => matches(row, one));
    const have = reach(row, field.split('.'));
    if (want && typeof want === 'object' && !(want instanceof Types.ObjectId)) {
      const { $in, $regex } = want as { $in?: unknown[]; $regex?: string };
      if ($in) return $in.some((value) => have.some((item) => same(item, value)));
      if ($regex) return have.some((item) => typeof item === 'string' && new RegExp($regex).test(item));
      throw new Error(`unsupported filter on ${field}`);
    }
    return have.some((item) => same(item, want));
  });
}

/** Applies `fn` to the parent of each place `path` names; `$[x]` picks array items by `arrayFilters`. */
function each(target: unknown, path: string[], arrayFilters: Row[], fn: (parent: Row, field: string) => void): void {
  if (!target || typeof target !== 'object') return;
  const [head, ...rest] = path;
  if (!rest.length) return fn(target as Row, head);
  const next = (target as Row)[head];
  const placeholder = /^\$\[(\w+)\]$/.exec(rest[0]);
  if (placeholder && Array.isArray(next)) {
    const prefix = `${placeholder[1]}.`;
    const filter = Object.fromEntries(
      arrayFilters.flatMap((one) => Object.entries(one)).filter(([name]) => name.startsWith(prefix)).map(([name, value]) => [name.slice(prefix.length), value]),
    );
    for (const item of next) if (matches(item, filter)) each(item, rest.slice(1), arrayFilters, fn);
  } else each(next, rest, arrayFilters, fn);
}

/** Just enough of Mongo for the queries the service makes. */
class MemoryStore implements AccountStore {
  data: Record<string, Row[]> = {};
  rows(name: string) { return (this.data[name] ??= []); }
  async find(name: string, filter: Row, limit = 0) {
    const found = this.rows(name).filter((row) => matches(row, filter));
    return limit ? found.slice(0, limit) : found;
  }
  async deleteMany(name: string, filter: Row) {
    const before = this.rows(name).length;
    this.data[name] = this.rows(name).filter((row) => !matches(row, filter));
    return before - this.data[name].length;
  }
  async updateMany(name: string, filter: Row, update: Row, arrayFilters: Row[] = []) {
    for (const row of this.rows(name).filter((one) => matches(one, filter))) {
      for (const [op, fields] of Object.entries(update)) {
        for (const [path, want] of Object.entries(fields as Row)) {
          each(row, path.split('.'), arrayFilters, (parent, field) => {
            if (op === '$set') parent[field] = want;
            else if (op === '$unset') delete parent[field];
            else if (op === '$pull') {
              parent[field] = (parent[field] as unknown[]).filter((item) => (want && typeof want === 'object' ? !matches(item, want as Row) : !same(item, want)));
            } else throw new Error(`unsupported update ${op}`);
          });
        }
      }
    }
  }
}

const A = new Types.ObjectId().toHexString();
const B = new Types.ObjectId().toHexString();

async function world(options: { password?: string; storageFails?: boolean; developer?: string } = {}) {
  const store = new MemoryStore();
  const postA = new Types.ObjectId();
  const postB = new Types.ObjectId();
  const chat = new Types.ObjectId();
  const d = store.data;
  d['users'] = [
    { _id: new Types.ObjectId(A), email: 'a@example.com', name: 'Ana', createdAt: new Date('2026-01-01T00:00:00Z'), ...(options.password ? { passwordHash: await bcrypt.hash(options.password, 4) } : {}) },
    { _id: new Types.ObjectId(B), email: 'b@example.com', name: 'Beka' },
  ];
  d['auth_sessions'] = [{ userId: A, tokenHash: 'x' }, { userId: B, tokenHash: 'y' }];
  d['meal_entries'] = [{ userId: A, day: '2026-11-20', facts: { name: 'Egg' } }, { userId: B, day: '2026-11-20' }];
  d['foods'] = [
    { userId: A, name: 'Egg', image: { key: `foods/${A}/f1-1.jpg`, width: 4, height: 4 } },
    { userId: B, name: 'Rice', image: { key: `foods/${B}/f2-1.jpg` } },
    { userId: B, name: 'Saved from a post', sourceRef: `post:${String(postA)}`, attribution: { label: 'Shared by Ana' } },
    { userId: B, name: 'Saved, from a product', sourceRef: `post:${String(postA)}`, attribution: { label: 'Open Food Facts · ODbL' } },
  ];
  d['exercises'] = [{ userId: B, name: 'Copied curl', sharedBy: { label: 'Ana', authorId: A, postId: String(postA) } }, { name: 'Bench press' }];
  d['training_plans'] = [
    { userId: B, name: 'Copied plan', sharedBy: { label: 'Ana', authorId: A }, workouts: [{ name: 'Day 1' }] },
    { userId: B, name: 'Own plan', workouts: [{ name: 'Mine' }, { name: 'Copied day', sharedBy: { label: 'Ana', authorId: A } }, { name: 'From other', sharedBy: { label: 'Gio', authorId: 'other' } }] },
  ];
  d['social_profiles'] = [{ userId: A, username: 'ana', avatarKey: `avatars/${A}/a.jpg` }, { userId: B, username: 'beka' }];
  d['post_media'] = [{ userId: A, key: `media/${A}/m1.mp4`, posterKey: `media/${A}/m1-poster.jpg`, postId: String(postA) }];
  d['food_posts'] = [
    { _id: postA, userId: A, title: 'Mine', linkKey: 'secret' },
    { _id: postB, userId: B, title: 'Theirs', linkViewers: [A, 'someone'] },
    { _id: new Types.ObjectId(), userId: B, repostOf: String(postA) },
    { _id: new Types.ObjectId(), userId: A, repostOf: String(postB) },
  ];
  d['post_likes'] = [{ userId: B, postId: String(postA) }, { userId: A, postId: String(postB) }, { userId: B, postId: String(postB) }];
  d['post_comments'] = [{ userId: B, postId: String(postA), text: 'nice' }, { userId: A, postId: String(postB), text: 'hi' }];
  d['post_reports'] = [{ userId: B, postId: String(postA), reason: 'spam' }];
  d['feed_feedback'] = [{ userId: B, kind: 'author', targetId: A }, { userId: B, kind: 'post', targetId: String(postA) }, { userId: B, kind: 'author', targetId: 'other' }];
  d['social_connections'] = [{ lowId: A, highId: B, state: 'friends' }, { lowId: B, highId: 'other', state: 'friends' }];
  d['conversations'] = [{ _id: chat, memberIds: [A, B] }, { _id: new Types.ObjectId(), memberIds: [B, 'other'] }];
  d['messages'] = [{ conversationId: String(chat), senderId: A, text: 'hello' }, { conversationId: String(chat), senderId: B, text: 'hey' }, { conversationId: 'elsewhere', senderId: B, text: 'keep' }];
  d['tournament_groups'] = [{ memberIds: [A, B], results: [{ userId: A, score: 1 }, { userId: B, score: 2 }] }];
  d['notification_deliveries'] = [{ recipientId: A, type: 'postLike' }, { recipientId: B, type: 'postLike' }];
  d['badge_awards'] = [{ userId: A, badgeId: 'first' }];
  d['loans'] = [{ userId: A, principalCents: 100 }];

  const deleted: string[] = [];
  const storage = {
    configured: true,
    delete: async (key: string) => { deleted.push(key); return !options.storageFails; },
    presignGet: async (key: string) => `https://files.example/${key}?signed`,
  } as unknown as StorageService;
  const sent: MailMessage[] = [];
  const mailer: Mailer = { provider: 'dev', send: async (message) => { sent.push(message); } };
  const events: string[] = [];
  const security = { hit: async () => undefined, record: async (type: string, _ctx: unknown, userId?: string) => { events.push(`${type}:${userId ?? ''}`); } } as unknown as SecurityService;
  const config = { developerUserId: options.developer, webBaseUrl: 'https://lifeportal.one' } as AppConfig;
  return { store, deleted, sent, events, postB, service: new AccountService(store, storage, security, config, mailer) };
}

describe('AccountService', () => {
  it('exports what the account owns, without secrets, storage locations or other people’s records', async () => {
    const { service } = await world({ password: 'correct horse' });
    const out = await service.export(A);
    expect(out.account).toEqual({ id: A, email: 'a@example.com', name: 'Ana', createdAt: '2026-01-01T00:00:00.000Z' });
    expect(out.data['meal_entries']).toEqual([{ userId: A, day: '2026-11-20', facts: { name: 'Egg' } }]);
    expect(out.data['foods']).toEqual([{ userId: A, name: 'Egg', image: { width: 4, height: 4 } }]);
    expect(out.data['messages']).toEqual([expect.objectContaining({ text: 'hello' })]);
    expect(out.data['food_posts']).toHaveLength(2);
    expect(out.data['auth_sessions']).toBeUndefined();
    const text = JSON.stringify(out.data);
    for (const leaked of ['Hash', 'secret', 'avatars/', 'foods/', 'media/', 'Rice', 'hey', 'b@example.com', 'Copied']) expect(text).not.toContain(leaked);
    expect(out.files.map((file) => file.kind).sort()).toEqual(['image', 'image', 'image', 'video']);
    expect(out.files.every((file) => file.url.includes(A) && file.url.endsWith('?signed'))).toBe(true);
  });

  it('refuses without the right confirmation and deletes nothing', async () => {
    const withPassword = await world({ password: 'correct horse' });
    await expect(withPassword.service.delete(A, { password: 'wrong' })).rejects.toMatchObject({ response: { code: 'WRONG_PASSWORD' } });
    await expect(withPassword.service.delete(A, { confirmEmail: 'a@example.com' })).rejects.toMatchObject({ response: { code: 'WRONG_PASSWORD' } });
    expect(withPassword.store.rows('users')).toHaveLength(2);
    expect(withPassword.deleted).toEqual([]);

    const google = await world();
    await expect(google.service.delete(A, { confirmEmail: 'b@example.com' })).rejects.toMatchObject({ response: { code: 'CONFIRM_EMAIL' } });
    await expect(google.service.delete(A, {})).rejects.toMatchObject({ response: { code: 'CONFIRM_EMAIL' } });
    expect(google.store.rows('meal_entries')).toHaveLength(2);

    const developer = await world({ password: 'correct horse', developer: A });
    await expect(developer.service.delete(A, { password: 'correct horse' })).rejects.toMatchObject({ response: { code: 'DEVELOPER_ACCOUNT' } });
  });

  it('deletes the account, its files and what others hold of it, and leaves everyone else whole', async () => {
    const { service, store, deleted, sent, events, postB } = await world();
    await expect(service.delete(A, { confirmEmail: ' A@Example.com ' })).resolves.toEqual({ success: true });

    expect(deleted.sort()).toEqual([`avatars/${A}/a.jpg`, `foods/${A}/f1-1.jpg`, `media/${A}/m1-poster.jpg`, `media/${A}/m1.mp4`]);
    const left = JSON.stringify(store.data);
    expect(left).not.toContain(A);
    expect(left).not.toContain('a@example.com');

    expect(store.rows('users').map((row) => row['email'])).toEqual(['b@example.com']);
    expect(store.rows('auth_sessions')).toEqual([{ userId: B, tokenHash: 'y' }]);
    expect(store.rows('food_posts')).toEqual([{ _id: postB, userId: B, title: 'Theirs', linkViewers: ['someone'] }]);
    expect(store.rows('post_likes')).toEqual([{ userId: B, postId: String(postB) }]);
    expect(store.rows('post_comments')).toEqual([]);
    expect(store.rows('post_reports')).toEqual([]);
    expect(store.rows('feed_feedback')).toEqual([{ userId: B, kind: 'author', targetId: 'other' }]);
    expect(store.rows('social_connections')).toEqual([{ lowId: B, highId: 'other', state: 'friends' }]);
    expect(store.rows('conversations')).toHaveLength(1);
    expect(store.rows('messages')).toEqual([{ conversationId: 'elsewhere', senderId: B, text: 'keep' }]);
    expect(store.rows('tournament_groups')).toEqual([{ memberIds: [B], results: [{ userId: B, score: 2 }] }]);
    expect(store.rows('foods').map((row) => (row['attribution'] as Row | undefined)?.['label'])).toEqual([undefined, 'Shared by a former member', 'Open Food Facts · ODbL']);
    expect(store.rows('exercises')).toEqual([{ userId: B, name: 'Copied curl', sharedBy: { label: 'a former member', postId: expect.any(String) } }, { name: 'Bench press' }]);
    expect(store.rows('training_plans')).toEqual([
      { userId: B, name: 'Copied plan', sharedBy: { label: 'a former member' }, workouts: [{ name: 'Day 1' }] },
      { userId: B, name: 'Own plan', workouts: [{ name: 'Mine' }, { name: 'Copied day', sharedBy: { label: 'a former member' } }, { name: 'From other', sharedBy: { label: 'Gio', authorId: 'other' } }] },
    ]);
    expect(left).not.toContain('Ana');
    expect(store.rows('meal_entries')).toHaveLength(1);
    expect(store.rows('badge_awards')).toEqual([]);
    expect(store.rows('loans')).toEqual([]);

    expect(events).toEqual(['account_deleted:']);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: 'a@example.com', subject: 'Your LifePortal account was deleted' });
  });

  it('deletes the pages only this person manages, and steps out of pages others also manage (spec 040)', async () => {
    const { service, store } = await world();
    const own = new Types.ObjectId();
    const shared = new Types.ObjectId();
    store.rows('users').push(
      { _id: own, kind: 'page', name: 'Own page', managers: [A], createdBy: A, email: 'own@pages.invalid' },
      { _id: shared, kind: 'page', name: 'Shared page', managers: [A, B], createdBy: A, email: 'shared@pages.invalid' },
    );
    store.rows('food_posts').push({ _id: new Types.ObjectId(), userId: String(own), title: 'From the page' }, { _id: new Types.ObjectId(), userId: String(shared), title: 'Stays' });
    store.rows('social_profiles').push({ userId: String(own), username: 'own-page' });
    await service.delete(A, { confirmEmail: 'a@example.com' });
    expect(store.rows('users').map((row) => row['name']).sort()).toEqual(['Beka', 'Shared page']);
    expect(store.rows('users').find((row) => row['name'] === 'Shared page')?.['managers']).toEqual([B]);
    expect(store.rows('food_posts').some((row) => row['title'] === 'From the page')).toBe(false);
    expect(store.rows('food_posts').some((row) => row['title'] === 'Stays')).toBe(true);
    expect(store.rows('social_profiles').some((row) => row['username'] === 'own-page')).toBe(false);
  });

  it('deletes nothing when a file could not be deleted, so it can be run again', async () => {
    const { service, store, sent } = await world({ storageFails: true });
    await expect(service.delete(A, { confirmEmail: 'a@example.com' })).rejects.toMatchObject({ response: { code: 'FILES_NOT_DELETED' } });
    expect(store.rows('users')).toHaveLength(2);
    expect(store.rows('auth_sessions')).toHaveLength(2);
    expect(store.rows('post_media')).toHaveLength(1);
    expect(sent).toEqual([]);
  });
});
