'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import {
  Apple,
  CalendarDays,
  CookingPot,
  Layers,
  Library,
  Repeat2,
  Utensils,
} from 'lucide-react';
import {
  REPORT_REASONS,
  type Audience,
  type FoodPost,
  type PostImportPreview,
  type PostImportResult,
  type PostPage,
  type ReportReason,
} from '@life-portal/shared-types';
import {
  PublishedFoodMacros,
  PublishedNutritionSummary,
} from './published-nutrition';
import { api } from '../lib/api';
import {
  PostAudienceControl,
  PostDateLink,
  PostOptions,
  PostRelativeTime,
} from './post-header-controls';
import { PostEngagement } from './post-engagement';
import { PostMediaCarousel } from './post-media';
import { MacroRings } from './macro-rings';
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
  feed = 'wall',
  empty,
}: {
  authorId?: string;
  preview?: 'normal' | 'friend' | 'stranger';
  /** `wall` is Wall and profiles (`GET /posts`); `forYou` is public discovery (spec 018). */
  feed?: 'wall' | 'forYou';
  /** Replaces the default empty-state card. */
  empty?: ReactNode;
}) {
  const [cursor, setCursor] = useState<string | undefined>();
  const [history, setHistory] = useState<(string | undefined)[]>([]);
  // For You: an author hidden from one card disappears from the rest of the page too. Maps the
  // author to the card that hid them, which stays as the Undo row.
  const [hiddenAuthors, setHiddenAuthors] = useState<Record<string, string>>({});
  const [scope, setScope] = useState(`${feed}:${authorId ?? ''}:${preview}`);
  const nextScope = `${feed}:${authorId ?? ''}:${preview}`;
  if (scope !== nextScope) {
    setScope(nextScope);
    setCursor(undefined);
    setHistory([]);
  }
  const query = new URLSearchParams(
    feed === 'forYou'
      ? { ...(cursor ? { cursor } : {}) }
      : {
          ...(authorId ? { authorId } : {}),
          preview,
          ...(cursor ? { cursor } : {}),
        },
  );
  const path = feed === 'forYou' ? '/posts/for-you' : '/posts';
  const search = query.toString();
  const result = useApi<PostPage>(
    search ? `${path}?${search}` : path,
    SOCIAL_REFRESH,
  );
  if (result.error)
    return <ErrorNote message={(result.error as Error).message} />;
  if (!result.data || result.isLoading)
    return <Spinner label="Loading posts…" />;
  return (
    <div className="space-y-5">
      <div className="-mx-4 space-y-0.5 sm:mx-0 sm:space-y-5">
        {result.data.posts.map((post) => {
          const key = post.repost?.id ?? post.id;
          const hiddenBy = hiddenAuthors[post.author.userId];
          return (
            <PostCard
              key={key}
              post={post}
              forYou={
                feed === 'forYou'
                  ? {
                      hiddenByOther: !!hiddenBy && hiddenBy !== key,
                      onAuthorHidden: (hidden) =>
                        setHiddenAuthors(({ [post.author.userId]: _, ...rest }) =>
                          hidden ? { ...rest, [post.author.userId]: key } : rest,
                        ),
                    }
                  : undefined
              }
            />
          );
        })}
      </div>
      {result.data.posts.length === 0 && history.length === 0 && empty}
      {result.data.posts.length === 0 && !empty && (
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
  forYou,
}: {
  post: FoodPost;
  detail?: boolean;
  /** Present on For You cards: enables Not interested / Hide author (issue #3, task A). */
  forYou?: {
    /** Another card on this page hid this post's author. */
    hiddenByOther: boolean;
    onAuthorHidden: (hidden: boolean) => void;
  };
}) {
  const [dismissed, setDismissed] = useState<'post' | 'author' | null>(null);
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
  /** Not interested (`post`) or hide the author (`author`) from For You, or undo either. */
  async function feedback(kind: 'post' | 'author', on: boolean) {
    const path = `/posts/${post.id}/${kind === 'post' ? 'not-interested' : 'hide-author'}`;
    const ok = await action.run(
      () => (on ? api.put(path) : api.delete(path)),
      { revalidate: false },
    );
    if (!ok) return;
    setDismissed(on ? kind : null);
    if (kind === 'author') forYou?.onAuthorHidden(on);
  }
  if (forYou?.hiddenByOther) return null;
  if (dismissed)
    return (
      <div className="card flex flex-wrap items-center gap-x-3 gap-y-2 p-4 text-sm text-ink-muted">
        <span className="min-w-0 flex-1">
          {dismissed === 'post'
            ? 'Got it. You won’t see this post in For You.'
            : `You won’t see posts from ${post.author.displayName} in For You.`}
        </span>
        <button
          type="button"
          className="btn-ghost shrink-0"
          disabled={action.pending}
          onClick={() => void feedback(dismissed, false)}
        >
          Undo
        </button>
        {action.error && (
          <div className="w-full">
            <ErrorNote message={action.error} />
          </div>
        )}
      </div>
    );
  if (removed)
    return (
      <p className="card p-5 text-sm text-ink-muted">
        Post removed.{' '}
        <Link href="/wall" className="text-accent">
          Back to Wall
        </Link>
      </p>
    );
  const presentation = {
    entry: {
      label: 'Logged food',
      icon: Utensils,
      tint: 'bg-orange-500/10 text-amber-400',
    },
    food: {
      label: 'Food',
      icon: Apple,
      tint: 'bg-emerald-500/10 text-emerald-400',
    },
    meal: {
      label: 'Meal',
      icon: CookingPot,
      tint: 'bg-orange-500/10 text-amber-400',
    },
    day: {
      label: 'Food diary',
      icon: CalendarDays,
      tint: 'bg-sky-500/10 text-accent',
    },
    combination: {
      label: 'Saved meal',
      icon: Layers,
      tint: 'bg-violet-500/10 text-accent',
    },
    database: {
      label: 'Food database',
      icon: Library,
      tint: 'bg-emerald-500/10 text-emerald-400',
    },
  }[post.kind ?? 'food'];
  const hasFood = !!post.kind;
  const PreviewIcon = presentation.icon;
  return (
    <article
      className={`card overflow-hidden p-4 sm:p-5 ${detail ? 'rounded-2xl' : 'rounded-none border-0 sm:rounded-2xl sm:border'}`}
    >
      {post.repost && (
        <p className="-mt-1 mb-3 flex items-center gap-1.5 text-xs text-ink-muted">
          <Repeat2 size={14} aria-hidden="true" />
          <Link href={`/people/${post.repost.by.userId}`} className="font-medium hover:text-ink">
            {post.repost.isMine ? 'You' : post.repost.by.displayName}
          </Link>
          reposted
          <span aria-hidden="true">·</span>
          <PostRelativeTime date={post.repost.createdAt} />
        </p>
      )}
      <div className="flex items-start gap-3">
        <Link
          href={`/people/${post.author.userId}`}
          aria-label={`View ${post.author.displayName}'s profile`}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/10 text-sm font-semibold text-accent"
        >
          {post.author.displayName.trim().slice(0, 1).toUpperCase()}
        </Link>
        <div className="min-w-0">
          <Link
            href={`/people/${post.author.userId}`}
            className="text-sm font-semibold hover:text-accent-hover"
          >
            {post.author.displayName}
          </Link>
          <div className="mt-0.5 flex items-center gap-1 text-[11px] text-ink-faint">
            <PostDateLink id={post.id} date={post.createdAt} />
            {hasFood && (
              <>
                <span aria-hidden="true">·</span>
                <span
                  title={`Shared ${presentation.label.toLowerCase()}`}
                  aria-label={`Shared ${presentation.label.toLowerCase()}`}
                >
                  <PreviewIcon size={13} aria-hidden="true" />
                </span>
              </>
            )}
            <PostAudienceControl
              id={post.id}
              audience={post.audience}
              isOwner={post.isOwner}
            />
          </div>
        </div>
        <PostOptions
          owner={post.isOwner}
          busy={action.pending}
          onEdit={() => setEditing(true)}
          onDelete={() => void remove()}
          onImport={hasFood ? () => setImporting(true) : undefined}
          onReport={() => setReporting(true)}
          onNotInterested={
            forYou ? () => void feedback('post', true) : undefined
          }
          onHideAuthor={
            forYou
              ? {
                  label: `Hide ${post.author.displayName} from For You`,
                  run: () => void feedback('author', true),
                }
              : undefined
          }
        />
      </div>
      {post.title && post.title !== post.contentLabel && (
        <h2 className="mt-4 whitespace-pre-wrap break-words text-lg font-semibold">
          {post.title}
        </h2>
      )}
      {post.caption && (
        <p
          className={`my-4 whitespace-pre-wrap break-words leading-relaxed ${!hasFood && !post.media.length && post.caption.length < 140 ? 'text-lg' : 'text-sm'}`}
        >
          {post.caption}
        </p>
      )}
      {post.media.length > 0 && !hasFood && (
        <div className="-mx-4 mt-4 sm:mx-0">
          <PostMediaCarousel media={post.media} />
        </div>
      )}
      {hasFood && (
      // Photos and the food are one card: no gap, rounded only on the outside.
      <div
        className="mt-4 overflow-hidden rounded-xl border border-border/60 bg-surface"
        data-post-kind={post.kind}
      >
        {post.media.length > 0 && <PostMediaCarousel media={post.media} className="" />}
        <div className="p-3 sm:p-4">
        <div className="flex items-center gap-3">
          <span
            className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${presentation.tint}`}
          >
            <PreviewIcon size={25} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="mb-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-faint">
              {presentation.label}
              {post.kind === 'database' ? ` · Collection v${post.version}` : ''}
            </p>
            <h2 className="break-words text-sm font-semibold sm:text-base">
              {detail ? (
                post.contentLabel || post.title || presentation.label
              ) : (
                <Link
                  href={`/posts/${post.id}`}
                  className="hover:text-accent-hover"
                >
                  {post.contentLabel || post.title || presentation.label}
                </Link>
              )}
            </h2>
            <p className="mt-1 text-xs text-ink-muted">
              {post.slot
                ? `${post.slot.charAt(0).toUpperCase() + post.slot.slice(1)} · `
                : ''}
              {post.day ? `${post.day} · ` : ''}
              {post.itemCount} food{post.itemCount === 1 ? '' : 's'}
              {post.totalKcal === undefined ? '' : ` · ${post.totalKcal} kcal`}
            </p>
          </div>
        </div>
        {post.kind !== 'day' && post.totalMacros ? (
          <MacroRings
            className="mt-3"
            kcal={post.totalMacros.energyKcal}
            proteinMg={post.totalMacros.proteinG * 1000}
            carbMg={post.totalMacros.carbG * 1000}
            fatMg={post.totalMacros.fatG * 1000}
          />
        ) : (
          <PublishedNutritionSummary
            totals={post.totalMacros}
            targets={post.targets}
            diary={post.kind === 'day'}
          />
        )}
        <ul
          className={`mt-3 divide-y divide-border/70 ${detail ? 'max-h-[32rem] overflow-y-auto' : ''}`}
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
              <PublishedFoodMacros food={food} />
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
            className="mt-3 inline-block text-sm text-accent"
          >
            View all {post.itemCount} foods →
          </Link>
        )}
        </div>
      </div>
      )}
      <PostEngagement
        post={post}
        onSaveFoods={hasFood && !post.isOwner ? () => setImporting(true) : undefined}
      />
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
