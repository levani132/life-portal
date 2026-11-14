import { ApiError, NetworkError } from '../api';
import {
  DRAFT_MAX_BYTES,
  draftProblem,
  mealWritesBefore,
  publishDraft,
  type DraftPhoto,
  type PostDraftBody,
  type PublishDeps,
} from './post-drafts';

const photo = (name: string, size = 10): DraftPhoto => ({ blob: new Blob(['x'.repeat(size)], { type: name }), width: 4, height: 3 });

const draft = (over: Partial<PostDraftBody> = {}): PostDraftBody => ({
  requestId: 'req-1',
  title: ' Lunch ',
  caption: 'Good ',
  audience: 'friends',
  photos: [photo('a'), photo('b')],
  ...over,
});

function deps(over: Partial<PublishDeps> = {}) {
  const uploads: string[] = [];
  const created: unknown[] = [];
  let n = 0;
  const value: PublishDeps = {
    upload: async (item) => {
      uploads.push(item.blob.type);
      return `m${++n}`;
    },
    preview: async () => 'hash-now',
    create: async (body) => {
      created.push(body);
      return { id: 'post-1' };
    },
    ...over,
  };
  return { value, uploads, created };
}

describe('post drafts (spec 032)', () => {
  it('uploads each photo, saving its id as it lands, then creates the post with the draft request id', async () => {
    const saved: PostDraftBody[] = [];
    const d = deps();
    const result = await publishDraft(draft(), async (body) => void saved.push(body), d.value);
    expect(result).toEqual({ id: 'post-1' });
    expect(d.uploads).toEqual(['a', 'b']);
    expect(saved.map((body) => body.photos.map((p) => p.mediaId))).toEqual([
      ['m1', undefined],
      ['m1', 'm2'],
    ]);
    expect(d.created).toEqual([
      { mediaIds: ['m1', 'm2'], title: 'Lunch', caption: 'Good', audience: 'friends', requestId: 'req-1' },
    ]);
  });

  it('does not upload again what a failed attempt already uploaded', async () => {
    let body = draft();
    let fail = true;
    const d = deps({
      create: async () => {
        if (fail) throw new NetworkError();
        return { id: 'post-1' };
      },
    });
    await expect(publishDraft(body, async (next) => void (body = next), d.value)).rejects.toBeInstanceOf(NetworkError);
    fail = false;
    await publishDraft(body, async (next) => void (body = next), d.value);
    expect(d.uploads).toEqual(['a', 'b']);
  });

  it('previews the food when it is published, so the numbers are the ones then', async () => {
    const d = deps();
    await publishDraft(draft({ photos: [], source: { kind: 'entry', entryId: 'e1' } }), async () => undefined, d.value);
    expect(d.created[0]).toMatchObject({ source: { kind: 'entry', entryId: 'e1' }, previewHash: 'hash-now' });
    expect(d.created[0]).not.toHaveProperty('mediaIds');
  });

  it('uploads again, once, when the server no longer has a photo', async () => {
    let calls = 0;
    const d = deps({
      create: async () => {
        calls += 1;
        if (calls === 1) throw new ApiError('gone', 400, undefined, 'MEDIA_GONE');
        return { id: 'post-1' };
      },
    });
    const start = draft({ photos: [{ ...photo('a'), mediaId: 'old' }] });
    await publishDraft(start, async () => undefined, d.value);
    expect(d.uploads).toEqual(['a']);
    expect(calls).toBe(2);
    const other = deps({ create: async () => Promise.reject(new ApiError('nope', 400, undefined, 'MEDIA_GONE')) });
    await expect(publishDraft(start, async () => undefined, other.value)).rejects.toBeInstanceOf(ApiError);
  });

  it('keeps photos only, at most four and 50 MB, for later', () => {
    expect(draftProblem([{ kind: 'image', bytes: 1 }])).toBeUndefined();
    expect(draftProblem([{ kind: 'video', bytes: 1 }])).toMatch(/video/);
    expect(draftProblem(Array.from({ length: 5 }, () => ({ kind: 'image', bytes: 1 })))).toMatch(/up to 4/);
    expect(draftProblem([{ kind: 'image', bytes: DRAFT_MAX_BYTES }, { kind: 'image', bytes: 1 }])).toMatch(/50 MB/);
  });

  it('waits for meals logged on this device when the post shows what was eaten', () => {
    const items = [
      { id: 'meal', kind: 'nutrition.entry.add' },
      { id: 'log', kind: 'nutrition.meal.log' },
      { id: 'weight', kind: 'nutrition.weighin.put' },
      { id: 'like', kind: 'social.like' },
    ];
    expect(mealWritesBefore({ kind: 'entry', entryId: 'e' }, items)).toEqual(['meal', 'log']);
    expect(mealWritesBefore({ kind: 'day', day: '2026-11-14' }, items)).toEqual(['meal', 'log']);
    expect(mealWritesBefore({ kind: 'food', foodId: 'f' }, items)).toEqual([]);
    expect(mealWritesBefore(undefined, items)).toEqual([]);
  });
});
