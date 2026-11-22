import { ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';
import type { AppConfig } from '../config/configuration';
import type { MailMessage } from '../mail/mailer';
import { ImageCheckError, type ImageChecker } from '../moderation/image-checker';
import { FakeModel } from '../training/fake-model.testing';
import { PostModerationService, visibleToOthers } from './post-moderation.service';

const DEV = 'dev';
const flush = () => new Promise((resolve) => setImmediate(resolve));

function world(options: { checker?: ImageChecker | null } = {}) {
  const posts = new FakeModel();
  const reports = new FakeModel();
  const sent: MailMessage[] = [];
  const removed: string[] = [];
  const access = {
    requireDeveloper: (id: string) => { if (id !== DEV) throw new ForbiddenException(); },
    suspendedAmong: async () => new Set<string>(['bad']),
    developerEmail: async () => 'dev@example.com',
    contactOf: async (id: string) => ({ email: `${id}@example.com`, name: `Name ${id}` }),
  };
  const social = { postAuthor: async (userId: string) => ({ userId, displayName: `Name ${userId}`, username: userId }) };
  const media = {
    sign: async (items?: { key: string; kind: string }[]) =>
      (items ?? []).map((item) => (item.kind === 'video' ? { kind: 'video', url: `u/${item.key}`, posterUrl: `u/${item.key}-poster` } : { kind: 'image', url: `u/${item.key}` })),
    removeForPost: async (id: string) => { removed.push(id); },
  };
  const checker = options.checker === undefined ? { provider: 'openai' as const, check: jest.fn(async () => ({ flagged: [] as string[] })) } : options.checker;
  const service = new PostModerationService(
    posts as never,
    reports as never,
    access as never,
    social as never,
    media as never,
    { disableSchedules: false, webBaseUrl: 'https://lifeportal.one', mail: { provider: 'resend', apiKey: 'k', from: 'LifePortal <no-reply@lifeportal.one>' } } as AppConfig,
    checker,
    { provider: 'dev', send: async (message) => { sent.push(message); } },
  );
  const add = async (fields: Record<string, unknown>) => {
    const row = await posts.create({ userId: 'author', title: 'T', caption: 'C', audience: 'public', deleted: false, ...fields });
    return String(row._id);
  };
  const post = (id: string) => posts.docs.find((doc) => String(doc['_id']) === id)!;
  return { service, posts, reports, sent, removed, checker, add, post };
}

describe('PostModerationService', () => {
  it('knows which posts other people can reach', () => {
    expect(visibleToOthers({ audience: 'public' })).toBe(true);
    expect(visibleToOthers({ audience: 'friends' })).toBe(true);
    expect(visibleToOthers({ audience: 'private' })).toBe(false);
    expect(visibleToOthers({ audience: 'private', linkKey: 'k' })).toBe(true);
  });

  it('holds a new post only when it has photos, others can reach it and a checker exists', () => {
    const on = world().service;
    expect(on.holdsNew({ audience: 'public', mediaCount: 1 })).toBe(true);
    expect(on.holdsNew({ audience: 'public', mediaCount: 0 })).toBe(false);
    expect(on.holdsNew({ audience: 'private', mediaCount: 2 })).toBe(false);
    expect(on.holdsNew({ audience: 'private', linkKey: 'k', mediaCount: 2 })).toBe(true);
    expect(world({ checker: null }).service.holdsNew({ audience: 'public', mediaCount: 1 })).toBe(false);
  });

  it('releases a post whose photos pass, judging a video by its still', async () => {
    const w = world();
    const id = await w.add({ heldAt: new Date(), heldReason: 'checking', media: [{ key: 'a.jpg', kind: 'image' }, { key: 'b.mp4', kind: 'video' }] });
    await w.service.check(id);
    expect((w.checker as unknown as { check: jest.Mock }).check).toHaveBeenCalledWith(['u/a.jpg', 'u/b.mp4-poster']);
    expect(w.post(id)).toMatchObject({ mediaCheck: 'ok' });
    expect(w.post(id)['heldAt']).toBeUndefined();
    expect(w.post(id)['heldReason']).toBeUndefined();
    expect(w.sent).toEqual([]);
  });

  it('keeps the scores of each check and lists them to the developer as numbers only', async () => {
    const w = world({ checker: { provider: 'openai', check: async () => ({ flagged: [], scores: { sexual: 0.31, violence: 0.02, harassment: 0.001 } }) } });
    const id = await w.add({ userId: DEV, title: 'Secret title', heldAt: new Date(), heldReason: 'checking', media: [{ key: 'a.jpg', kind: 'image' }] });
    await w.service.check(id);
    expect(w.post(id)).toMatchObject({ mediaCheck: 'ok', checkScores: { sexual: 0.31 } });
    await expect(w.service.recentChecks('someone')).rejects.toBeInstanceOf(ForbiddenException);
    const checks = await w.service.recentChecks(DEV);
    expect(checks).toEqual([{ checkedAt: expect.any(String), result: 'ok', mine: true, scores: [{ category: 'sexual', score: 0.31 }, { category: 'violence', score: 0.02 }, { category: 'harassment', score: 0.001 }] }]);
    expect(JSON.stringify(checks)).not.toMatch(/Secret|a\.jpg/);
    expect(JSON.stringify(checks)).not.toContain(id);
  });

  it('keeps a flagged post hidden, records why and tells the reviewer without naming anything', async () => {
    const w = world({ checker: { provider: 'openai', check: async () => ({ flagged: ['sexual', 'violence'] }) } });
    const id = await w.add({ heldAt: new Date(), heldReason: 'checking', media: [{ key: 'a.jpg', kind: 'image' }] });
    await w.service.check(id);
    await flush();
    expect(w.post(id)).toMatchObject({ heldReason: 'check', mediaCheck: 'flagged', checkCategories: ['sexual'] });
    expect(w.post(id)['heldAt']).toBeInstanceOf(Date);
    expect(w.sent).toHaveLength(1);
    expect(w.sent[0].to).toBe('dev@example.com');
    expect(JSON.stringify(w.sent[0])).not.toMatch(new RegExp(`${id}|Name author|a\\.jpg`));
  });

  it('leaves a post held when the check fails, and the retry job finishes it later', async () => {
    const check = jest.fn<Promise<{ flagged: string[] }>, [string[]]>().mockRejectedValueOnce(new ImageCheckError('down')).mockResolvedValue({ flagged: [] });
    const w = world({ checker: { provider: 'openai', check } });
    const id = await w.add({ heldAt: new Date('2026-11-22T10:00:00Z'), heldReason: 'checking', media: [{ key: 'a.jpg', kind: 'image' }] });
    await w.service.check(id);
    expect(w.post(id)).toMatchObject({ heldReason: 'checking' });
    await w.service.retryChecks(new Date('2026-11-22T10:00:30Z'));
    expect(check).toHaveBeenCalledTimes(1);
    await w.service.retryChecks(new Date('2026-11-22T10:05:00Z'));
    expect(w.post(id)).toMatchObject({ mediaCheck: 'ok' });
    expect(w.post(id)['heldAt']).toBeUndefined();
  });

  it('holds a private post with photos when it is opened to others, once', async () => {
    const w = world();
    const id = await w.add({ media: [{ key: 'a.jpg', kind: 'image' }] });
    const textOnly = await w.add({});
    const stillPrivate = await w.add({ audience: 'private', media: [{ key: 'p.jpg', kind: 'image' }] });
    await w.service.onVisible(id);
    await w.service.onVisible(textOnly);
    await w.service.onVisible(stillPrivate);
    await flush();
    expect(w.post(id)).toMatchObject({ mediaCheck: 'ok' });
    expect(w.post(textOnly)['mediaCheck']).toBeUndefined();
    expect(w.post(stillPrivate)['heldAt']).toBeUndefined();
    expect((w.checker as unknown as { check: jest.Mock }).check).toHaveBeenCalledTimes(1);
    await w.service.onVisible(id);
    await flush();
    expect((w.checker as unknown as { check: jest.Mock }).check).toHaveBeenCalledTimes(1);
  });

  it('hides a post after three reports, or one about a child, and not one a reviewer kept', async () => {
    const w = world();
    const id = await w.add({});
    for (const [n, reason] of ['spam', 'nudity', 'other'].entries()) {
      await w.reports.create({ userId: `r${n}`, postId: id, reason });
      await w.service.onReport(id);
      expect(!!w.post(id)['heldAt']).toBe(n === 2);
    }
    expect(w.post(id)).toMatchObject({ heldReason: 'reports' });
    await flush();
    expect(w.sent).toHaveLength(1);

    const child = await w.add({});
    await w.reports.create({ userId: 'r0', postId: child, reason: 'child_safety' });
    await w.service.onReport(child);
    expect(w.post(child)).toMatchObject({ heldReason: 'reports' });

    const kept = await w.add({ reviewedAt: new Date() });
    for (const n of [0, 1, 2]) await w.reports.create({ userId: `r${n}`, postId: kept, reason: 'spam' });
    await w.service.onReport(kept);
    expect(w.post(kept)['heldAt']).toBeUndefined();
  });

  it('lists what waits for review to the developer only: held first, with the post itself', async () => {
    const w = world();
    const flagged = await w.add({ userId: 'bad', heldAt: new Date(), heldReason: 'check', checkCategories: ['sexual'], media: [{ key: 'a.jpg', kind: 'image' }] });
    const reported = await w.add({ audience: 'friends' });
    const stuck = await w.add({ heldAt: new Date('2026-11-22T09:00:00Z'), heldReason: 'checking' });
    const checking = await w.add({ heldAt: new Date('2026-11-22T09:59:00Z'), heldReason: 'checking' });
    await w.add({});
    await w.reports.create({ userId: 'r0', postId: reported, reason: 'spam' });
    await w.reports.create({ userId: 'r1', postId: reported, reason: 'spam' });
    await w.reports.create({ userId: 'r2', postId: String(new Types.ObjectId()), reason: 'spam' });

    await expect(w.service.queue('someone')).rejects.toBeInstanceOf(ForbiddenException);
    const { items, imageCheck } = await w.service.queue(DEV, new Date('2026-11-22T10:00:00Z'));
    expect(imageCheck).toBe(true);
    expect(items.map((item) => item.postId).sort()).toEqual([flagged, reported, stuck].sort());
    expect(items.map((item) => item.postId)).not.toContain(checking);
    expect(items[items.length - 1].postId).toBe(reported);
    const first = items.find((item) => item.postId === flagged)!;
    expect(first).toMatchObject({ held: 'check', checkCategories: ['sexual'], author: { id: 'bad', suspended: true }, media: [{ url: 'u/a.jpg' }] });
    expect(items.find((item) => item.postId === reported)).toMatchObject({ reportCount: 2, reports: [{ reason: 'spam', count: 2 }], audience: 'friends' });
    // The report on a post that no longer exists is closed, not shown.
    expect(w.reports.docs.filter((doc) => !doc['resolvedAt'])).toHaveLength(2);
  });

  it('keeps or removes a post, closing its reports either way', async () => {
    const w = world();
    const keep = await w.add({ heldAt: new Date(), heldReason: 'reports' });
    const drop = await w.add({ heldAt: new Date(), heldReason: 'check', media: [{ key: 'a.jpg', kind: 'image' }], linkKey: 'k' });
    await w.reports.create({ userId: 'r0', postId: keep, reason: 'spam' });
    await w.reports.create({ userId: 'r0', postId: drop, reason: 'nudity' });
    await expect(w.service.keep('someone', keep)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(w.service.remove('someone', drop)).rejects.toBeInstanceOf(ForbiddenException);

    await w.service.keep(DEV, keep);
    expect(w.post(keep)['heldAt']).toBeUndefined();
    expect(w.post(keep)['reviewedAt']).toBeInstanceOf(Date);

    await w.service.remove(DEV, drop);
    expect(w.post(drop)).toMatchObject({ deleted: true, title: 'Removed post', caption: '' });
    for (const field of ['media', 'heldAt', 'linkKey']) expect(w.post(drop)[field]).toBeUndefined();
    expect(w.removed).toEqual([drop]);
    await flush();
    // The author is told, with their own title and how to object; keeping a post sends nothing.
    expect(w.sent).toHaveLength(1);
    expect(w.sent[0]).toMatchObject({ to: 'author@example.com', subject: 'LifePortal: your post was removed' });
    expect(w.sent[0].text).toContain('"T"');
    expect(w.sent[0].text).toContain('support@lifeportal.one');
    expect(w.sent[0].text).toContain('https://lifeportal.one/rules');
    await w.service.remove(DEV, drop);
    await flush();
    expect(w.sent).toHaveLength(1);
    expect(w.reports.docs.map((doc) => doc['resolution'])).toEqual(['kept', 'removed']);
    expect((await w.service.queue(DEV)).items).toEqual([]);
  });
});
