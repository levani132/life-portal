'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  REPORT_REASONS,
  type Audience,
  type FoodPost,
  type PostImportPreview,
  type PostImportResult,
  type PostPage,
  type ReportReason,
} from '@life-portal/shared-types';
import { mgToG } from '@life-portal/shared-domain';
import { api } from '../lib/api';
import { revalidate, useAction, useApi } from '../lib/hooks';
import { SOCIAL_REFRESH } from '../lib/social-hooks';
import {
  ErrorNote,
  Field,
  Input,
  Modal,
  Select,
  Spinner,
  Textarea,
} from './ui';
export function PostsList({
  authorId,
  preview = 'normal',
}: {
  authorId?: string;
  preview?: 'normal' | 'friend' | 'stranger';
}) {
  const [cursor, setCursor] = useState<string | undefined>();
  const [history, setHistory] = useState<(string | undefined)[]>([]);
  const [scope, setScope] = useState(`${authorId ?? ''}:${preview}`);
  const nextScope = `${authorId ?? ''}:${preview}`;
  if (scope !== nextScope) {
    setScope(nextScope);
    setCursor(undefined);
    setHistory([]);
  }
  const query = new URLSearchParams({
    ...(authorId ? { authorId } : {}),
    preview,
    ...(cursor ? { cursor } : {}),
  });
  const result = useApi<PostPage>(`/posts?${query}`, SOCIAL_REFRESH);
  if (result.error)
    return <ErrorNote message={(result.error as Error).message} />;
  if (!result.data || result.isLoading)
    return <Spinner label="Loading posts…" />;
  return (
    <div className="space-y-5">
      {result.data.posts.map((post) => (
        <PostCard key={post.id} post={post} />
      ))}
      {result.data.posts.length === 0 && (
        <div className="card p-6 text-sm text-ink-muted">
          {authorId
            ? 'No posts shared with this audience yet.'
            : 'No posts here yet. Share something from Food or find friends who want to share with you.'}
        </div>
      )}
      <div className="flex items-center justify-between gap-3">
        {history.length > 0 && (
          <button
            type="button"
            className="btn-ghost"
            onClick={() => {
              setCursor(history.at(-1));
              setHistory((h) => h.slice(0, -1));
            }}
          >
            Newer posts
          </button>
        )}
        {result.data.nextCursor && (
          <button
            type="button"
            className="btn-ghost ml-auto"
            onClick={() => {
              setHistory((h) => [...h, cursor]);
              setCursor(result.data!.nextCursor);
            }}
          >
            Older posts
          </button>
        )}
      </div>
    </div>
  );
}
export function PostCard({
  post,
  detail = false,
}: {
  post: FoodPost;
  detail?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [removed, setRemoved] = useState(false);
  const action = useAction();
  const router = useRouter();
  async function remove() {
    if (
      await action.run(
        async () => {
          await api.delete(`/posts/${post.id}`);
          setRemoved(true);
          if (detail) router.replace('/wall');
          await revalidate('/posts');
        },
        { revalidate: false },
      )
    )
      setRemoved(true);
  }
  if (removed)
    return (
      <p className="card p-5 text-sm text-ink-muted">
        Post removed.{' '}
        <Link href="/wall" className="text-sky-300">
          Back to Wall
        </Link>
      </p>
    );
  return (
    <article className="card p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <Link
            href={`/people/${post.author.userId}`}
            className="font-semibold hover:text-sky-300"
          >
            {post.author.displayName}
          </Link>
          <p className="mt-1 text-xs text-ink-faint">
            @{post.author.username} ·{' '}
            <time dateTime={post.createdAt}>
              {new Date(post.createdAt).toLocaleDateString()}
            </time>{' '}
            ·{' '}
            {post.audience === 'private'
              ? 'Only me'
              : post.audience === 'friends'
                ? 'Friends'
                : 'Everyone in Life Portal'}
          </p>
        </div>
        {post.kind === 'database' && (
          <span className="text-xs text-sky-300">
            Collection v{post.version}
          </span>
        )}
      </div>
      <h2 className="break-words text-lg font-semibold">
        {detail ? (
          post.title
        ) : (
          <Link href={`/posts/${post.id}`} className="hover:text-sky-300">
            {post.title}
          </Link>
        )}
      </h2>
      {post.caption && (
        <p className="mt-3 whitespace-pre-wrap break-words text-sm text-ink-muted">
          {post.caption}
        </p>
      )}
      <p className="mt-3 text-xs text-ink-faint">
        {post.day ? `${post.day} · ` : ''}
        {post.itemCount} food{post.itemCount === 1 ? '' : 's'}
        {post.totalKcal === undefined ? '' : ` · ${post.totalKcal} kcal`}
      </p>
      <ul
        className={`mt-4 divide-y divide-border ${detail ? 'max-h-[32rem] overflow-y-auto' : ''}`}
      >
        {post.items.map((food) => (
          <li key={food.key} className="py-3 text-sm">
            <div className="flex flex-wrap justify-between gap-2">
              <span className="font-medium">
                {food.name}
                {food.brand && (
                  <span className="ml-1 text-ink-faint">{food.brand}</span>
                )}
              </span>
              <span className="text-ink-muted">
                {food.amount === undefined
                  ? `Per 100 ${food.unit}`
                  : `${food.amount} ${food.unit}`}
                {food.slot ? ` · ${food.slot}` : ''}
              </span>
            </div>
            {detail && (
              <p className="mt-1 text-xs text-ink-muted">
                Per 100 {food.unit}: {food.energyKcalPer100} kcal · P{' '}
                {mgToG(food.proteinMgPer100)}g · C {mgToG(food.carbMgPer100)}g ·
                F {mgToG(food.fatMgPer100)}g
              </p>
            )}
            {food.attribution && (
              <p className="mt-1 text-xs text-ink-faint">
                {food.attribution.url ? (
                  <a
                    href={food.attribution.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="underline"
                  >
                    {food.attribution.label}
                  </a>
                ) : (
                  food.attribution.label
                )}
              </p>
            )}
          </li>
        ))}
      </ul>
      {!detail && post.itemCount > post.items.length && (
        <Link
          href={`/posts/${post.id}`}
          className="mt-3 inline-block text-sm text-sky-300"
        >
          View all {post.itemCount} foods →
        </Link>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        {!detail && (
          <Link href={`/posts/${post.id}`} className="btn-ghost">
            Open post
          </Link>
        )}
        {!post.isOwner && (
          <button
            type="button"
            className="btn-primary"
            onClick={() => setImporting(true)}
          >
            Import foods
          </button>
        )}
        {post.isOwner ? (
          <>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setEditing(true)}
            >
              Edit audience / caption
            </button>
            <button
              type="button"
              className="btn-ghost text-rose-300"
              disabled={action.pending}
              onClick={() => void remove()}
            >
              Delete post
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn-ghost"
            onClick={() => setReporting(true)}
          >
            Report / hide
          </button>
        )}
      </div>
      {action.error && <ErrorNote message={action.error} />}
      {editing && <EditPost post={post} onClose={() => setEditing(false)} />}
      {reporting && (
        <ReportPost
          postId={post.id}
          onClose={() => setReporting(false)}
          onReported={() => setRemoved(true)}
        />
      )}
      {importing && (
        <ImportPost postId={post.id} onClose={() => setImporting(false)} />
      )}
    </article>
  );
}
function EditPost({ post, onClose }: { post: FoodPost; onClose: () => void }) {
  const [title, setTitle] = useState(post.title);
  const [caption, setCaption] = useState(post.caption);
  const [audience, setAudience] = useState<Audience>(post.audience);
  const action = useAction();
  return (
    <Modal
      open
      onClose={onClose}
      title="Edit post"
      submitLabel="Save post"
      pending={action.pending}
      error={action.error}
      onSubmit={(e) => {
        e.preventDefault();
        void action.run(
          async () => {
            await api.patch(`/posts/${post.id}`, {
              title,
              caption,
              audience,
            });
            await revalidate('/posts');
            onClose();
          },
          { revalidate: false },
        );
      }}
    >
      <Field label="Post title">
        <Input
          required
          maxLength={120}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </Field>
      <Field label="Caption">
        <Textarea
          maxLength={1000}
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
        />
      </Field>
      <Field label="Post audience">
        <Select
          value={audience}
          onChange={(e) => setAudience(e.target.value as Audience)}
        >
          <option value="private">Only me</option>
          <option value="friends">Friends</option>
          <option value="public">Everyone in Life Portal</option>
        </Select>
      </Field>
      <p className="text-xs text-ink-muted">
        Food facts stay as posted. Previously imported copies won’t change.
      </p>
    </Modal>
  );
}
function ReportPost({
  postId,
  onClose,
  onReported,
}: {
  postId: string;
  onClose: () => void;
  onReported: () => void;
}) {
  const [reason, setReason] = useState<ReportReason>('other');
  const action = useAction();
  return (
    <Modal open onClose={onClose} title="Report and hide post">
      <p className="mb-4 text-sm text-ink-muted">
        This hides the post from you and sends a report for review.
      </p>
      <Field label="Reason">
        <Select
          value={reason}
          onChange={(e) => setReason(e.target.value as ReportReason)}
        >
          {REPORT_REASONS.map((r) => (
            <option key={r} value={r}>
              {r[0].toUpperCase() + r.slice(1)}
            </option>
          ))}
        </Select>
      </Field>
      {action.error && <ErrorNote message={action.error} />}
      <button
        className="btn-primary mt-4"
        disabled={action.pending}
        onClick={() =>
          void action.run(
            async () => {
              await api.post(`/posts/${postId}/report`, { reason });
              onReported();
              onClose();
              await revalidate('/posts');
            },
            { revalidate: false },
          )
        }
      >
        Report and hide
      </button>
    </Modal>
  );
}
function ImportPost({
  postId,
  onClose,
}: {
  postId: string;
  onClose: () => void;
}) {
  const post = useApi<FoodPost>(`/posts/${postId}`);
  const preview = useApi<PostImportPreview>(`/posts/${postId}/import`);
  const action = useAction();
  const [selected, setSelected] = useState<string[] | null>(null);
  const [duplicatePolicy, setDuplicatePolicy] = useState<'skip' | 'copy'>(
    'skip',
  );
  const [saveAsMeal, setSaveAsMeal] = useState(false);
  const [mealName, setMealName] = useState('');
  const [result, setResult] = useState<PostImportResult | null>(null);
  const keys =
    selected ??
    preview.data?.items
      .filter((item) => !item.alreadyImported && !item.duplicateName)
      .map((item) => item.key) ??
    [];
  return (
    <Modal open onClose={onClose} title="Import food copies" wide>
      {post.error || preview.error ? (
        <ErrorNote message="This post is no longer available to import." />
      ) : !post.data || !preview.data ? (
        <Spinner />
      ) : result ? (
        <div className="space-y-4">
          <p className="font-medium text-emerald-400">
            {result.createdCount} foods imported privately.
          </p>
          <p className="text-sm text-ink-muted">
            {result.reusedCount} already imported; {result.skippedCount}{' '}
            skipped. Nothing was added to your meal log.
          </p>
          {result.savedMealId && (
            <p className="text-sm text-ink-muted">
              A saved meal is ready in your Foods tab.
            </p>
          )}
          <Link
            href="/nutrition?tab=foods"
            className="btn-primary"
            onClick={onClose}
          >
            Open my foods
          </Link>
        </div>
      ) : (
        <fieldset disabled={action.pending} className="space-y-4">
          <p className="text-sm text-ink-muted">
            Choose foods to copy into your database. Copies start private, keep
            attribution and won’t change when the author edits or deletes their
            post.
          </p>
          <div className="max-h-64 space-y-2 overflow-y-auto">
            {post.data.items.map((food) => {
              const status = preview.data!.items.find(
                (item) => item.key === food.key,
              )!;
              return (
                <label
                  key={food.key}
                  className="flex items-start gap-3 rounded-lg border border-border p-3 text-sm"
                >
                  <input
                    type="checkbox"
                    className="mt-1 shrink-0"
                    checked={keys.includes(food.key)}
                    onChange={(e) =>
                      setSelected(
                        e.target.checked
                          ? [...keys, food.key]
                          : keys.filter((k) => k !== food.key),
                      )
                    }
                  />
                  <span>
                    {food.name}
                    <span className="mt-1 block text-xs text-ink-faint">
                      {food.energyKcalPer100} kcal / 100 {food.unit}
                      {status.alreadyImported
                        ? ' · Already imported'
                        : status.duplicateName
                          ? ` · Matching food: ${status.duplicateName}`
                          : ''}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
          <button
            type="button"
            className="btn-ghost"
            onClick={() =>
              setSelected(post.data!.items.map((item) => item.key))
            }
          >
            Select all
          </button>
          <Field label="Matching food names">
            <Select
              value={duplicatePolicy}
              onChange={(e) =>
                setDuplicatePolicy(e.target.value as typeof duplicatePolicy)
              }
            >
              <option value="skip">Skip matching names</option>
              <option value="copy">Create a new copy</option>
            </Select>
          </Field>
          {preview.data.canSaveMeal && (
            <>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={saveAsMeal}
                  onChange={(e) => setSaveAsMeal(e.target.checked)}
                />
                Also save the whole combination as a meal
              </label>
              {saveAsMeal && (
                <Field
                  label="Saved meal name"
                  hint="Select every food. Use Create a new copy for matching names."
                >
                  <Input
                    maxLength={120}
                    value={mealName}
                    placeholder={post.data.title}
                    onChange={(e) => setMealName(e.target.value)}
                  />
                </Field>
              )}
            </>
          )}
          {action.error && <ErrorNote message={action.error} />}
          <button
            type="button"
            className="btn-primary"
            disabled={!keys.length || action.pending}
            onClick={() =>
              void action.run(
                async () => {
                  setResult(
                    await api.post<PostImportResult>(
                      `/posts/${postId}/import`,
                      {
                        itemKeys: keys,
                        duplicatePolicy,
                        saveAsMeal,
                        mealName: mealName || post.data!.title,
                      },
                    ),
                  );
                  await revalidate('/nutrition');
                  await revalidate('/dashboard');
                  await preview.mutate();
                },
                { revalidate: false },
              )
            }
          >
            {action.pending ? 'Importing…' : 'Import selected foods'}
          </button>
        </fieldset>
      )}
    </Modal>
  );
}
