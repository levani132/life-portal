'use client';
import { APP_NAME } from '../lib/brand';
import { Avatar } from './avatar';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
  REPORT_REASON_LABELS,
  type Audience,
  type FeedMetricEvent,
  type FeedMetricsStatus,
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
import { describePlanRule, planSlotsLabel } from '@life-portal/shared-domain';
import {
  PostAudienceControl,
  PostDateLink,
  PostOptions,
  PostRelativeTime,
} from './post-header-controls';
import { PostEngagement } from './post-engagement';
import { PostMediaCarousel } from './post-media';
import { METRICS_KEY } from './for-you-preferences';
import { MacroRings } from './macro-rings';
import { UsePlanFromPost } from './meal-plans';
import { CopyTrainingButton, TrainingAttachmentView } from './training/training-post';
import { revalidate, useAction, useApi } from '../lib/hooks';
import { PageMark } from './identity-switcher';
import { OfficialMark } from './follow';
import { SOCIAL_REFRESH } from '../lib/social-hooks';
import {
  FeedMetricsContext,
  PostMetricsContext,
  useFeedMetricsTracker,
  useImpression,
} from '../lib/feed-metrics';
import {
  ErrorNote,
  Field,
  Input,
  Modal,
  Select,
  Spinner,
  Textarea,
} from './ui';
const FOR_YOU_REFRESH = { ...SOCIAL_REFRESH, refreshInterval: 0, revalidateOnFocus: false };


/**
 * Why For You placed a post (#9): the first reason in one quiet line under the header, all of
 * them and what they are based on when opened. Only ever on ranked For You cards.
 */
export function ForYouReasons({ reasons }: { reasons?: FoodPost['reasons'] }) {
  if (!reasons?.length) return null;
  return (
    <details className="group mt-2 text-[11px] text-ink-faint">
      <summary className="cursor-pointer list-none truncate hover:text-ink-muted [&::-webkit-details-marker]:hidden">
        <span className="sr-only">Why you're seeing this: </span>
        {reasons[0].text}
        <span aria-hidden="true" className="ml-1 group-open:hidden">· Why?</span>
      </summary>
      <div className="mt-1 space-y-0.5">
        <p className="font-medium text-ink-muted">Why you're seeing this</p>
        <ul className="list-disc pl-4">
          {reasons.map((reason) => (
            <li key={`${reason.code}:${reason.topicId ?? ''}`}>{reason.text}</li>
          ))}
        </ul>
        <p>
          Based only on your likes, comments and reposts in the last 90 days, and interests you
          choose. Never your food logs, weight or health data.
        </p>
      </div>
    </details>
  );
}

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
  // The feed only grows downwards: the first page comes from the cache below, later pages are
  // appended here as the reader nears the end. Nothing loaded is ever taken away, and there is
  // no "newer" button: the Home tab goes back to the top.
  const [more, setMore] = useState<FoodPost[]>([]);
  /** Where the next page starts: `undefined` until the first page says, `null` at the end. */
  const [next, setNext] = useState<string | null | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState('');
  const loading = useRef(false);
  const sentinel = useRef<HTMLDivElement>(null);
  // For You: an author hidden from one card disappears from the rest of the page too. Maps the
  // author to the card that hid them, which stays as the Undo row.
  const [hiddenAuthors, setHiddenAuthors] = useState<Record<string, string>>({});
  const [scope, setScope] = useState(`${feed}:${authorId ?? ''}:${preview}`);
  const nextScope = `${feed}:${authorId ?? ''}:${preview}`;
  const reset = () => {
    setMore([]);
    setNext(undefined);
    setMoreError('');
  };
  if (scope !== nextScope) {
    setScope(nextScope);
    reset();
  }
  const base: Record<string, string> = feed === 'forYou' ? {} : { ...(authorId ? { authorId } : {}), preview };
  const path = feed === 'forYou' ? '/posts/for-you' : '/posts';
  const url = (cursor?: string) => {
    const search = new URLSearchParams({ ...base, ...(cursor ? { cursor } : {}) }).toString();
    return search ? `${path}?${search}` : path;
  };
  const result = useApi<PostPage>(
    url(),
    // A ranked For You first page starts a new session (#9), so polling it would reshuffle the
    // feed under the reader and expire the pages below. It refreshes when asked.
    feed === 'forYou' ? FOR_YOU_REFRESH : SOCIAL_REFRESH,
  );
  // For You measurement (#11): only when the API says it is on and not opted out.
  const metrics = useApi<FeedMetricsStatus>(
    feed === 'forYou' ? METRICS_KEY : null,
    FOR_YOU_REFRESH,
  );
  const tracker = useFeedMetricsTracker(metrics.data?.active === true);
  // A For You first page that changed is a new session: its later pages belong to the old order.
  const firstCursor = result.data?.nextCursor;
  const startedFrom = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (feed === 'forYou' && startedFrom.current !== undefined && startedFrom.current !== firstCursor) {
      startedFrom.current = undefined;
      setMore([]);
      setNext(undefined);
    }
  }, [feed, firstCursor]);
  const cursor = next === undefined ? firstCursor : (next ?? undefined);
  const mutateFirst = result.mutate;
  const loadMore = useCallback(async () => {
    if (!cursor || loading.current) return;
    loading.current = true;
    setLoadingMore(true);
    setMoreError('');
    try {
      const page = await api.get<PostPage>(url(cursor));
      if (page.expired) {
        // The feed was rebuilt since this page was opened: start again from its new first page.
        startedFrom.current = undefined;
        setMore([]);
        setNext(undefined);
        await mutateFirst();
        return;
      }
      if (startedFrom.current === undefined) startedFrom.current = firstCursor;
      setMore((rows) => [...rows, ...page.posts]);
      setNext(page.nextCursor ?? null);
    } catch (caught) {
      setMoreError(caught instanceof Error ? caught.message : 'Could not load more posts.');
    } finally {
      loading.current = false;
      setLoadingMore(false);
    }
    // `url` is rebuilt each render from the same inputs as `cursor`.
  }, [cursor, firstCursor, mutateFirst, path, authorId, preview]);
  // Load the next page a screen before the reader reaches the end.
  useEffect(() => {
    const node = sentinel.current;
    if (!node || !cursor || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => entries.some((entry) => entry.isIntersecting) && void loadMore(), {
      rootMargin: '800px 0px',
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [cursor, loadMore]);
  if (result.error)
    return <ErrorNote message={(result.error as Error).message} />;
  if (!result.data || result.isLoading)
    return <Spinner label="Loading posts…" />;
  if (result.data.expired)
    return (
      <div className="card p-6 text-sm text-ink-muted">
        <p>Your For You feed has been refreshed since this page was loaded.</p>
        <button
          type="button"
          className="btn-ghost mt-3"
          onClick={() => {
            reset();
            void mutateFirst();
          }}
        >
          Back to the top
        </button>
      </div>
    );
  // One list, each post once: a post that moved between pages while reading is not repeated.
  const shownKeys = new Set<string>();
  const posts = [...result.data.posts, ...more].filter((post) => {
    const key = post.repost?.id ?? post.id;
    return !shownKeys.has(key) && !!shownKeys.add(key);
  });
  return (
    <FeedMetricsContext.Provider value={tracker}>
    <div className="space-y-5">
      <div className="-mx-4 space-y-0.5 sm:mx-0 sm:space-y-5">
        {posts.map((post) => {
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
      {posts.length === 0 && empty}
      {posts.length === 0 && !empty && (
        <div className="card p-6 text-sm text-ink-muted">
          {authorId
            ? 'No posts shared with this audience yet.'
            : 'No posts here yet. Share something, find friends, or follow a page.'}
        </div>
      )}
      {moreError && <ErrorNote message={moreError} />}
      {cursor && (
        <div ref={sentinel} className="flex justify-center py-2">
          {loadingMore ? (
            <Spinner label="Loading more posts…" />
          ) : (
            // Shown where the page cannot watch the scroll, and after a failed load.
            <button type="button" className="btn-ghost" onClick={() => void loadMore()}>
              Load more posts
            </button>
          )}
        </div>
      )}
    </div>
    </FeedMetricsContext.Provider>
  );
}
/**
 * A recipe's own words (spec 042): ingredients written by hand and the method. In a feed the
 * card says how much there is and links to the post; the post itself shows all of it.
 */
function RecipeText({ recipe, postId, detail }: { recipe: NonNullable<FoodPost['recipe']>; postId: string; detail: boolean }) {
  if (!recipe.ingredients.length && !recipe.steps.length) return null;
  if (!detail) {
    const parts = [
      recipe.ingredients.length ? `${recipe.ingredients.length} more ${recipe.ingredients.length === 1 ? 'ingredient' : 'ingredients'}` : '',
      recipe.steps.length ? `${recipe.steps.length} ${recipe.steps.length === 1 ? 'step' : 'steps'}` : '',
    ].filter(Boolean);
    return (
      <Link href={`/posts/${postId}`} className="mt-3 block text-sm text-accent">
        Recipe: {parts.join(' · ')} →
      </Link>
    );
  }
  return (
    <div className="mt-4 space-y-3 border-t border-border/70 pt-3 text-sm">
      {recipe.ingredients.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Ingredients</h3>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {recipe.ingredients.map((line, index) => (
              <li key={index} className="break-words">
                {line}
              </li>
            ))}
          </ul>
        </div>
      )}
      {recipe.steps.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Method</h3>
          <ol className="mt-1 list-decimal space-y-1 pl-5">
            {recipe.steps.map((line, index) => (
              <li key={index} className="break-words">
                {line}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
/**
 * The post's diet tags (issue #8), computed by the API from the published facts. Each states its
 * basis on hover and to screen readers (principle VI). Hashtags are not repeated as chips: they
 * are already in the caption.
 */
function DietTopicChips({ topics }: { topics?: FoodPost['topics'] }) {
  const diet = (topics ?? []).filter((topic) => topic.kind === 'diet');
  if (!diet.length) return null;
  return (
    <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Diet tags">
      {diet.map((topic) => (
        <li
          key={topic.id}
          title={topic.basis}
          className="rounded-full border border-border bg-surface-raised px-2 py-0.5 text-[11px] font-medium text-ink-muted"
        >
          {topic.label}
          <span className="sr-only">: {topic.basis}</span>
        </li>
      ))}
    </ul>
  );
}

export function PostCard({
  post,
  detail = false,
  openShare = false,
  forYou,
  focusCommentId,
}: {
  post: FoodPost;
  detail?: boolean;
  /** Open the comments on this comment or reply (a notification's link). */
  focusCommentId?: string;
  /** Open with the share sheet showing (a post just made by sharing from Food or Training). */
  openShare?: boolean;
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
  // For You measurement (#11): a For You card's events, while measurement is active.
  const tracker = useContext(FeedMetricsContext);
  const onForYou = !!forYou;
  const recordMetric = useMemo(
    () =>
      onForYou && tracker
        ? (type: FeedMetricEvent) => tracker.record(post.id, type)
        : null,
    [onForYou, tracker, post.id],
  );
  const card = useRef<HTMLElement>(null);
  useImpression(card, recordMetric ? () => recordMetric('impression') : null);
  // Spec 039: the photo check takes a few seconds; look again so the note goes away by itself.
  const checking = post.held === 'checking';
  useEffect(() => {
    if (!checking) return;
    const timer = window.setTimeout(() => void revalidate('/posts'), 5000);
    return () => window.clearTimeout(timer);
  }, [checking, post.updatedAt]);
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
    if (kind === 'post' && on) recordMetric?.('notInterested');
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
      tint: 'bg-warning-solid/10 text-warning',
    },
    food: {
      label: 'Food',
      icon: Apple,
      tint: 'bg-success-solid/10 text-success',
    },
    meal: {
      label: 'Meal',
      icon: CookingPot,
      tint: 'bg-warning-solid/10 text-warning',
    },
    day: {
      label: 'Food diary',
      icon: CalendarDays,
      tint: 'bg-info-solid/10 text-accent',
    },
    combination: {
      label: 'Saved meal',
      icon: Layers,
      tint: 'bg-special-solid/10 text-accent',
    },
    database: {
      label: 'Food database',
      icon: Library,
      tint: 'bg-success-solid/10 text-success',
    },
    mealPlan: {
      label: 'Meal plan',
      icon: Utensils,
      tint: 'bg-info-solid/10 text-info',
    },
  }[post.kind ?? 'food'];
  // Spec 042: a meal plan's numbers are per day, not for all its days added up.
  const planDays = post.kind === 'mealPlan' ? Math.max(1, post.days?.length ?? 1) : 1;
  const perDay = (value: number) => Math.round(value / planDays);
  const hasFood = !!post.kind;
  const PreviewIcon = presentation.icon;
  return (
    <PostMetricsContext.Provider value={recordMetric}>
    <article
      ref={card}
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
      <div className="-ml-1 -mt-1 flex items-center gap-2.5">
        <Link
          href={`/people/${post.author.userId}`}
          aria-label={`View ${post.author.displayName}'s profile`}
          className="shrink-0"
        >
          <Avatar name={post.author.displayName} url={post.author.avatarUrl} size={48} />
        </Link>
        <div className="min-w-0 flex-1 leading-tight">
          <Link
            href={`/people/${post.author.userId}`}
            className="text-sm font-semibold leading-tight hover:text-accent-hover"
          >
            {post.author.displayName}
          </Link>
          {post.author.official && <OfficialMark className="ml-1" />}
          {post.author.isPage && <PageMark className="ml-1.5" ai={post.author.aiManaged} />}
          <div className="flex items-center gap-1 text-[11px] leading-tight text-ink-faint">
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
              linkOnly={post.linkOnly}
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
      {forYou && <ForYouReasons reasons={post.reasons} />}
      {post.held && (
        <p role="status" className="mt-3 rounded-lg bg-warning-solid/10 px-3 py-2 text-xs text-warning">
          {post.held === 'checking'
            ? 'Your photo is being checked. Only you can see this post until that is done, usually in a few seconds.'
            : 'Only you can see this post for now: it is waiting for a review.'}
        </p>
      )}
      {post.title && post.title !== post.contentLabel && (
        <h2 className="mt-3 whitespace-pre-wrap break-words text-lg font-semibold">
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
              {post.itemCount === 0 && post.kind === 'mealPlan'
                ? `A plan of ${post.planRules?.plan.length ?? 0} ${post.planRules?.plan.length === 1 ? 'rule' : 'rules'}`
                : post.itemCount === 0
                ? 'Recipe · no nutrition numbers'
                : post.kind === 'mealPlan'
                  ? `${planDays} ${planDays === 1 ? 'day' : 'days'}${post.totalKcal === undefined ? '' : ` · about ${perDay(post.totalKcal)} kcal a day`}`
                  : `${post.itemCount} food${post.itemCount === 1 ? '' : 's'}${post.totalKcal === undefined ? '' : ` · ${post.totalKcal} kcal`}`}
            </p>
          </div>
        </div>
        {post.itemCount === 0 ? null : post.kind !== 'day' && post.totalMacros ? (
          <MacroRings
            className="mt-3"
            kcal={perDay(post.totalMacros.energyKcal)}
            proteinMg={perDay(post.totalMacros.proteinG * 1000)}
            carbMg={perDay(post.totalMacros.carbG * 1000)}
            fatMg={perDay(post.totalMacros.fatG * 1000)}
          />
        ) : (
          <PublishedNutritionSummary
            totals={post.totalMacros}
            targets={post.targets}
            diary={post.kind === 'day'}
          />
        )}
        <DietTopicChips topics={post.topics} />
        {/* Spec 043: a plan's rules, as sentences. */}
        {post.planRules && (post.planRules.plan.length > 0 || post.planRules.days.some((rules) => rules.length > 0)) && (
          <ul className="mt-3 space-y-1 rounded-xl bg-surface px-3 py-2 text-sm">
            {post.planRules.plan.map((rule, index) => (
              <li key={`p${index}`}>• {describePlanRule(rule)}</li>
            ))}
            {post.planRules.days.flatMap((rules, dayIndex) =>
              rules.map((rule, index) => (
                <li key={`d${dayIndex}-${index}`}>
                  • {describePlanRule(rule)} <span className="text-ink-faint">({post.days?.[dayIndex] ?? `day ${dayIndex + 1}`})</span>
                </li>
              )),
            )}
          </ul>
        )}
        <ul
          className={`mt-3 divide-y divide-border/70 ${detail ? 'max-h-[32rem] overflow-y-auto' : ''}`}
        >
          {post.items.map((food, index) => (
            <li key={food.key} className="py-3 text-sm">
              {post.days && food.dayIndex !== undefined && food.dayIndex !== post.items[index - 1]?.dayIndex && (
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">{post.days[food.dayIndex] ?? `Day ${food.dayIndex + 1}`}</p>
              )}
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
                  {food.slots && food.slots.length > 1 ? ` · ${planSlotsLabel(food.slots).toLowerCase()}` : food.slot ? ` · ${food.slot}` : ''}
                  {food.group ? ` · ${food.group}` : ''}
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
        {post.kind === 'mealPlan' && !post.isOwner && (post.itemCount > 0 || !!post.planRules) && <UsePlanFromPost postId={post.id} title={post.title || post.contentLabel || 'Meal plan'} />}
        {!detail && post.itemCount > post.items.length && (
          <Link
            href={`/posts/${post.id}`}
            className="mt-3 inline-block text-sm text-accent"
          >
            View all {post.itemCount} foods →
          </Link>
        )}
        {post.recipe && <RecipeText recipe={post.recipe} postId={post.id} detail={detail} />}
        </div>
      </div>
      )}
      {post.training && (
        // Spec 036: the Training attachment, exactly as published. A feed card shows the start of it.
        <div className="mt-4 rounded-xl border border-border/60 bg-surface p-3 sm:p-4">
          {detail ? (
            <TrainingAttachmentView training={post.training} />
          ) : (
            // On a feed card: a summary, and the whole of it opens the post.
            <Link href={`/posts/${post.id}`} className="block" aria-label={`Open post: ${post.training.label}`}>
              <TrainingAttachmentView training={post.training} compact />
              <span className="mt-3 inline-block text-sm text-accent">Open post →</span>
            </Link>
          )}
          {post.canCopy && <CopyTrainingButton postId={post.id} training={post.training} />}
          {post.isOwner && post.allowCopy === false && (
            <p className="mt-3 text-xs text-ink-faint">Copying is off: others can look, not copy.</p>
          )}
        </div>
      )}
      <PostEngagement
        openShare={openShare}
        focusCommentId={focusCommentId}
        post={post}
        onSaveFoods={hasFood && post.itemCount > 0 && !post.isOwner ? () => setImporting(true) : undefined}
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
    </PostMetricsContext.Provider>
  );
}
function EditPost({ post, onClose }: { post: FoodPost; onClose: () => void }) {
  const [title, setTitle] = useState(post.title);
  const [caption, setCaption] = useState(post.caption);
  const [audience, setAudience] = useState<Audience>(post.audience);
  const [allowCopy, setAllowCopy] = useState(post.allowCopy !== false);
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
              ...(post.training ? { allowCopy } : {}),
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
          <option value="public">Everyone in {APP_NAME}</option>
        </Select>
      </Field>
      {post.training && (
        <label className="flex min-h-11 cursor-pointer items-center gap-3">
          <span className="min-w-0 flex-1">
            <span className="block text-sm">Allow copying</span>
            <span className="block text-xs text-ink-faint">Off: others can look, not copy. Copies already made stay.</span>
          </span>
          <input
            type="checkbox"
            className="h-5 w-5 shrink-0 accent-[rgb(var(--accent-solid))]"
            checked={allowCopy}
            onChange={(event) => setAllowCopy(event.target.checked)}
          />
        </label>
      )}
      <p className="text-xs text-ink-muted">
        {post.training ? 'What was shared stays as posted.' : 'Food facts stay as posted.'} Previously imported copies won’t change.
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
              {REPORT_REASON_LABELS[r]}
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
  // Spec 042: a published meal plan can be kept as the reader's own plan.
  const [savePlan, setSavePlan] = useState(false);
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
          <p className="font-medium text-success">
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
          {post.data.kind === 'mealPlan' && (
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 h-5 w-5 shrink-0 accent-[rgb(var(--accent))]"
                checked={savePlan}
                onChange={(e) => {
                  setSavePlan(e.target.checked);
                  if (e.target.checked) {
                    // A plan is copied whole: every food, each as a new copy.
                    setSelected(post.data!.items.map((item) => item.key));
                    setDuplicatePolicy('copy');
                  }
                }}
              />
              <span>
                Also save it as my own meal plan
                <span className="block text-xs text-ink-muted">Every food is saved, and the plan appears in Food → Meal plans. Nothing is logged.</span>
              </span>
            </label>
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
                        ...(savePlan ? { savePlan: true } : {}),
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
