'use client';
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import clsx from 'clsx';
import {
  Camera,
  ChevronDown,
  CookingPot,
  Globe,
  ImagePlus,
  Lock,
  Play,
  Plus,
  RotateCcw,
  Users,
  X,
} from 'lucide-react';
import {
  MAX_POST_MEDIA,
  type Audience,
  type Food,
  type MealEntry,
  type MealSlot,
  type MediaConfig,
  type NutritionProfile,
  type PostPreview,
  type PostSelection,
} from '@life-portal/shared-types';
import { clampAspect, postHasContent, publicationMacros } from '@life-portal/shared-domain';
import { api } from '../lib/api';
import { revalidate, useApi } from '../lib/hooks';
import { mealContextNow } from '../lib/local-day';
import { prepareImage, uploadMedia, type PreparedMedia } from '../lib/media';
import { splitPostDraft } from '../lib/post-draft';
import { CameraView } from './post-camera';
import { PostFoodPicker, type PickedFood } from './post-food-picker';
import {
  EMPTY_FOOD,
  NewFoodCard,
  newFoodNumbers,
  newFoodReady,
  type NewFoodDraft,
} from './new-food-card';
import { MacroRings } from './macro-rings';
import { PublishedFoodMacros, PublishedNutritionSummary } from './published-nutrition';
import { ErrorNote, Spinner } from './ui';
import { requestNotificationOffer } from './notifications';

const audiences = {
  private: { label: 'Only me', icon: Lock },
  friends: { label: 'Friends', icon: Users },
  public: { label: 'Everyone in Life Portal', icon: Globe },
};
const SLOT_LABELS: Record<MealSlot, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snack',
  uncategorized: 'A meal',
};

interface Attachment {
  localId: string;
  media: PreparedMedia;
  status: 'uploading' | 'done' | 'failed';
  progress: number;
  id?: string;
  error?: string;
  abort: AbortController;
}

/** Where the camera sits: half the screen, all of it, or out of the way. */
type CameraState = 'half' | 'full' | 'hidden';

/**
 * The new post page (`/new`). The composer is on top and the camera live underneath, like a
 * chat app's camera: drag the camera up to fill the screen, or down to put it away. Captures and
 * library photos drop into the composer, uploading while the person writes.
 *
 * A post can carry one food: picked from Food, or a new one typed here. A new food can be saved,
 * logged and posted in one go; the buttons say exactly which.
 */
export function PostComposer({
  onClose,
  onDone,
  initialSource,
  defaultAudience,
}: {
  onClose: () => void;
  /** Where to go once something was saved or posted. */
  onDone?: (path: string) => void;
  initialSource?: PostSelection;
  defaultAudience?: Audience;
}) {
  const [food, setFood] = useState<PickedFood | null>(
    initialSource ? { source: initialSource, label: '' } : null,
  );
  const [newFood, setNewFood] = useState<NewFoodDraft | null>(null);
  const [saveFood, setSaveFood] = useState(true);
  const [logFood, setLogFood] = useState(false);
  const created = useRef<{ foodId?: string; entryId?: string; key?: string }>({});
  const [preview, setPreview] = useState<PostPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [draft, setDraft] = useState({ title: '', caption: '' });
  const [captionOnly, setCaptionOnly] = useState(false);
  const [audience, setAudience] = useState<Audience>(defaultAudience ?? 'friends');
  const audienceTouched = useRef(!!defaultAudience);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [picking, setPicking] = useState(false);
  const [camera, setCamera] = useState<CameraState>(initialSource ? 'hidden' : 'half');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestId] = useState(() => crypto.randomUUID());
  const titleInput = useRef<HTMLTextAreaElement>(null);
  const captionInput = useRef<HTMLTextAreaElement>(null);
  const library = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const viewport = useVisualViewport();
  const mediaConfig = useApi<MediaConfig>('/media/config');
  const mediaAvailable = !!mediaConfig.data?.available;
  const profile = useApi<{ profile: NutritionProfile }>('/nutrition/profile');
  const dayStartHour = profile.data?.profile.dayStartHour ?? 4;
  useEffect(() => {
    const preferred = profile.data?.profile.defaultFoodVisibility;
    if (preferred && !audienceTouched.current) setAudience(preferred);
  }, [profile.data]);
  const done = (path: string) => (onDone ? onDone(path) : onClose());

  const source = food?.source;
  useEffect(() => {
    setPreview(null);
    setPreviewError(null);
    if (!source) return;
    let active = true;
    void api
      .post<PostPreview>('/posts/preview', { source })
      .then((result) => {
        if (active) setPreview(result);
      })
      .catch((e: unknown) => {
        if (active)
          setPreviewError(e instanceof Error ? e.message : 'Could not prepare this food.');
      });
    return () => {
      active = false;
    };
  }, [source, retry]);

  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !picking) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, picking]);
  useEffect(
    () => () => {
      for (const item of attachmentsRef.current) {
        item.abort.abort();
        URL.revokeObjectURL(item.media.previewUrl);
      }
    },
    [],
  );

  const update = (localId: string, change: Partial<Attachment>) =>
    setAttachments((items) =>
      items.map((item) => (item.localId === localId ? { ...item, ...change } : item)),
    );
  const startUpload = useCallback((item: Attachment) => {
    update(item.localId, { status: 'uploading', progress: 0, error: undefined });
    uploadMedia(item.media, (progress) => update(item.localId, { progress }), item.abort.signal)
      .then((id) => update(item.localId, { status: 'done', progress: 1, id }))
      .catch((e: unknown) => {
        if ((e as Error).name === 'AbortError') return;
        update(item.localId, {
          status: 'failed',
          error: e instanceof Error ? e.message : 'Upload failed.',
        });
      });
  }, []);
  const add = useCallback(
    (media: PreparedMedia) => {
      if (attachmentsRef.current.length >= MAX_POST_MEDIA) {
        setError(`A post can have up to ${MAX_POST_MEDIA} photos and videos.`);
        return;
      }
      const item: Attachment = {
        localId: crypto.randomUUID(),
        media,
        status: 'uploading',
        progress: 0,
        abort: new AbortController(),
      };
      setAttachments((items) => [...items, item]);
      startUpload(item);
      // A full-screen camera steps back so the capture is visible in the post.
      setCamera((state) => (state === 'full' ? 'half' : state));
    },
    [startUpload],
  );
  async function addFiles(files: FileList | null) {
    if (!files) return;
    const room = MAX_POST_MEDIA - attachments.length;
    const chosen = Array.from(files).filter((file) => file.type.startsWith('image/') || !file.type);
    if (chosen.length > room) setError(`A post can have up to ${MAX_POST_MEDIA} photos and videos.`);
    for (const file of chosen.slice(0, room)) {
      try {
        add(await prepareImage(file));
      } catch {
        setError('One of those photos could not be read.');
      }
    }
  }
  function remove(localId: string) {
    setAttachments((items) => {
      const item = items.find((i) => i.localId === localId);
      item?.abort.abort();
      if (item) URL.revokeObjectURL(item.media.previewUrl);
      return items.filter((i) => i.localId !== localId);
    });
  }
  function focusCaption() {
    requestAnimationFrame(() => {
      const input = captionInput.current;
      input?.focus();
      input?.setSelectionRange(input.value.length, input.value.length);
    });
  }

  const uploading = attachments.some((item) => item.status === 'uploading');
  const failed = attachments.some((item) => item.status === 'failed');
  const uploadsSettled = !uploading && !failed;
  const hasContent = postHasContent({
    title: draft.title,
    caption: draft.caption,
    mediaCount: attachments.length,
    hasFood: !!food,
  });
  const ready =
    hasContent && uploadsSettled && (!food || !!preview) && draft.caption.length <= 1000 && !pending;
  const mediaIds = () => attachments.map((item) => item.id!).filter(Boolean);

  async function createPost(postSource?: PostSelection, hash?: string) {
    let previewHash = hash;
    if (postSource && !previewHash)
      previewHash = (await api.post<PostPreview>('/posts/preview', { source: postSource })).previewHash;
    const post = await api.post<{ id: string }>('/posts', {
      ...(postSource ? { source: postSource, previewHash } : {}),
      ...(attachments.length ? { mediaIds: mediaIds() } : {}),
      title: draft.title.trim(),
      caption: draft.caption.trim(),
      audience,
      requestId,
    });
    await revalidate('/posts');
    requestNotificationOffer('post');
    return post;
  }

  async function publish() {
    if (!ready) return;
    setPending(true);
    setError(null);
    try {
      const post = await createPost(food && preview ? food.source : undefined, preview?.previewHash);
      done(`/posts/${post.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not publish.');
    } finally {
      setPending(false);
    }
  }

  /**
   * Saves (and logs, and posts) the new food. Each step remembers what it made, so retrying after
   * a failure continues instead of making a second food or a second log entry.
   */
  async function submitNewFood(post: boolean) {
    if (!newFood || !newFoodReady(newFood) || !uploadsSettled) return;
    const keep = saveFood;
    const log = saveFood && logFood;
    const key = JSON.stringify([newFood, keep]);
    if (created.current.key !== key) created.current = { key };
    setPending(true);
    setError(null);
    try {
      if (!created.current.foodId) {
        const photo = keep ? attachments.find((item) => item.status === 'done')?.id : undefined;
        const food = await api.post<Food>('/nutrition/foods', {
          name: newFood.name.trim(),
          unit: newFood.unit,
          entryMode: 'per_serving',
          servingLabel: '1 portion',
          ...newFoodNumbers(newFood),
          // Posted without saving: the food exists only so the post can freeze its numbers.
          ...(keep ? {} : { archived: true }),
          ...(photo ? { imageMediaId: photo } : {}),
        });
        created.current.foodId = food.id;
      }
      const foodId = created.current.foodId;
      if (log && !created.current.entryId) {
        const context = mealContextNow(dayStartHour);
        const entry = await api.post<MealEntry>('/nutrition/entries', {
          day: context.day,
          slot: context.slot,
          foodId,
          servings: 1,
        });
        created.current.entryId = entry.id;
      }
      void revalidate('/nutrition');
      if (!post) {
        done('/nutrition');
        return;
      }
      const entryId = created.current.entryId;
      const result = await createPost(entryId ? { kind: 'entry', entryId } : { kind: 'food', foodId });
      done(`/posts/${result.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setPending(false);
    }
  }

  // ---------------------------------------------------------------- camera panel dragging
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const drag = useRef<{ y: number; start: number; t: number; moved: boolean } | null>(null);
  const total = () => root.current?.clientHeight ?? window.innerHeight;
  const heightFor = (state: CameraState) =>
    state === 'full' ? total() : state === 'half' ? Math.round(total() * 0.5) : 0;
  function dragStart(event: ReactPointerEvent) {
    drag.current = { y: event.clientY, start: heightFor(camera), t: performance.now(), moved: false };
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
  }
  function dragMove(event: ReactPointerEvent) {
    const state = drag.current;
    if (!state) return;
    const dy = event.clientY - state.y;
    if (!state.moved && Math.abs(dy) < 6) return;
    state.moved = true;
    setDragHeight(Math.min(total(), Math.max(0, state.start - dy)));
  }
  function dragEnd(event: ReactPointerEvent) {
    const state = drag.current;
    drag.current = null;
    if (!state?.moved) {
      setDragHeight(null);
      return;
    }
    const dy = event.clientY - state.y;
    const velocity = dy / Math.max(1, performance.now() - state.t);
    const height = Math.min(total(), Math.max(0, state.start - dy));
    const stops: [CameraState, number][] = [
      ['hidden', 0],
      ['half', total() * 0.5],
      ['full', total()],
    ];
    let next = stops.reduce((best, stop) =>
      Math.abs(stop[1] - height) < Math.abs(best[1] - height) ? stop : best,
    )[0];
    // A flick moves one stop in its direction even when it did not travel far.
    if (Math.abs(velocity) > 0.6) {
      const order: CameraState[] = ['hidden', 'half', 'full'];
      const at = order.indexOf(camera);
      next = order[Math.min(2, Math.max(0, at + (velocity < 0 ? 1 : -1)))];
    }
    setDragHeight(null);
    setCamera(next);
  }

  const cameraHeight =
    dragHeight ?? (camera === 'full' ? '100%' : camera === 'half' ? '50%' : 0);
  const cameraVisible = dragHeight !== null ? dragHeight > 40 : camera !== 'hidden';
  const AudienceIcon = audiences[audience].icon;
  const atLimit = attachments.length >= MAX_POST_MEDIA;
  const slotLabel = SLOT_LABELS[mealContextNow(dayStartHour).slot];
  const firstPhoto = attachments[0]?.media;
  const mergedPhoto = (newFood || (food && preview)) && attachments.length === 1;

  return (
    <div
      ref={root}
      className="fixed inset-x-0 top-0 z-50 flex flex-col overflow-hidden bg-surface"
      style={{ height: viewport.height, transform: `translateY(${viewport.offsetTop}px)` }}
      role="dialog"
      aria-modal="true"
      aria-label="New post"
      data-no-tab-swipe
    >
      <div
        className={clsx('flex min-h-0 flex-1 flex-col', camera === 'full' && dragHeight === null && 'hidden')}
        onFocusCapture={(event) => {
          // Typing needs the room the keyboard leaves: the camera steps aside.
          const target = event.target as HTMLElement;
          if (target.matches('textarea, input:not([type=checkbox]), select')) setCamera('hidden');
        }}
      >
        <header className="flex shrink-0 items-center gap-2 border-b border-border px-2 pb-2 pt-[calc(var(--top-chrome)+0.25rem)]">
          <button
            type="button"
            aria-label="Close"
            className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-ink/5"
            onClick={onClose}
          >
            <X size={22} />
          </button>
          <h2 className="flex-1 text-center text-base font-semibold">New post</h2>
          {newFood ? (
            <span className="h-10 w-16" />
          ) : (
            <button
              type="button"
              className="rounded-full bg-accent px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
              disabled={!ready}
              onClick={() => void publish()}
            >
              {pending ? 'Sharing…' : uploading ? 'Uploading…' : 'Share'}
            </button>
          )}
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {error && (
            <div className="px-4 pt-3">
              <ErrorNote message={error} />
            </div>
          )}
          <fieldset disabled={pending} className="space-y-1 px-4 pt-3">
            {!captionOnly && (
              <textarea
                ref={titleInput}
                rows={1}
                maxLength={1000}
                aria-label="Post title"
                placeholder="Title"
                value={draft.title}
                className="w-full resize-none border-0 bg-transparent text-lg font-semibold text-ink outline-none placeholder:text-ink-faint"
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    if (!draft.title) setCaptionOnly(true);
                    focusCaption();
                  }
                }}
                onChange={(event) => {
                  const value = event.target.value;
                  event.currentTarget.style.height = 'auto';
                  event.currentTarget.style.height = `${Math.max(28, event.currentTarget.scrollHeight)}px`;
                  const next = splitPostDraft(value + (draft.caption ? `\n${draft.caption}` : ''));
                  setDraft(next);
                  if (!next.title && next.caption) {
                    setCaptionOnly(true);
                    focusCaption();
                  } else if (value.includes('\n')) focusCaption();
                }}
              />
            )}
            <textarea
              ref={captionInput}
              rows={captionOnly ? 4 : 2}
              maxLength={1000}
              aria-label="Post caption"
              placeholder={captionOnly ? 'What’s happening?' : 'Write something…'}
              value={draft.caption}
              className="w-full resize-none border-0 bg-transparent text-[15px] leading-relaxed text-ink outline-none placeholder:text-ink-faint"
              onChange={(event) => setDraft((current) => ({ ...current, caption: event.target.value }))}
            />
            {captionOnly && (
              <button
                type="button"
                className="text-xs text-ink-muted underline"
                onClick={() => {
                  setCaptionOnly(false);
                  requestAnimationFrame(() => titleInput.current?.focus());
                }}
              >
                Add a title
              </button>
            )}
            {draft.caption.length > 1000 && (
              <p role="alert" className="text-xs text-rose-400">
                Keep the text within 1,000 characters.
              </p>
            )}
          </fieldset>

          {attachments.length > 0 && !mergedPhoto && (
            <ul className="no-scrollbar mt-3 flex gap-2 overflow-x-auto px-4 pb-1" aria-label="Photos and videos">
              {attachments.map((item, index) => (
                <AttachmentTile
                  key={item.localId}
                  item={item}
                  index={index}
                  onRemove={() => remove(item.localId)}
                  onRetry={() => {
                    const next = { ...item, abort: new AbortController() };
                    setAttachments((items) => items.map((i) => (i.localId === item.localId ? next : i)));
                    startUpload(next);
                  }}
                />
              ))}
            </ul>
          )}
          {mergedPhoto && attachments[0].status !== 'done' && (
            <div className="mx-4 mt-3 flex items-center gap-2 text-xs text-ink-muted">
              {attachments[0].status === 'uploading' ? (
                <>Uploading photo… {Math.round(attachments[0].progress * 100)}%</>
              ) : (
                <>
                  Upload failed.
                  <button type="button" className="underline" onClick={() => startUpload(attachments[0])}>
                    Retry
                  </button>
                </>
              )}
            </div>
          )}

          {newFood && (
            <NewFoodCard
              draft={newFood}
              onChange={setNewFood}
              photo={mergedPhoto ? firstPhoto : undefined}
              save={saveFood}
              log={logFood}
              onSave={setSaveFood}
              onLog={setLogFood}
              slotLabel={slotLabel}
              onRemove={() => setNewFood(null)}
              onKeep={() => void submitNewFood(false)}
              onPost={() => void submitNewFood(true)}
              busy={pending}
              disabled={!newFoodReady(newFood) || !uploadsSettled}
            />
          )}

          {food && (
            <PickedFoodCard
              food={food}
              preview={preview}
              previewError={previewError}
              photo={mergedPhoto ? firstPhoto : undefined}
              onRemove={() => setFood(null)}
              onRetry={() => setRetry((value) => value + 1)}
            />
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1 border-t border-border px-2 py-1.5">
          <ToolButton label={food ? 'Replace the food' : 'Add from Food'} onClick={() => setPicking(true)}>
            <Plus size={22} />
          </ToolButton>
          <ToolButton
            label="New food"
            pressed={!!newFood}
            onClick={() => {
              setFood(null);
              setNewFood((current) => current ?? EMPTY_FOOD);
            }}
          >
            <CookingPot size={20} />
          </ToolButton>
          {mediaAvailable && (
            <>
              <ToolButton label="Add photos" disabled={atLimit} onClick={() => library.current?.click()}>
                <ImagePlus size={21} />
              </ToolButton>
              {camera === 'hidden' && (
                <ToolButton label="Camera" disabled={atLimit} onClick={() => setCamera('half')}>
                  <Camera size={21} />
                </ToolButton>
              )}
            </>
          )}
          <div
            className="relative ml-auto flex h-10 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm text-ink-muted hover:bg-ink/5 focus-within:ring-2 focus-within:ring-accent"
            title={audiences[audience].label}
          >
            <AudienceIcon size={16} aria-hidden="true" />
            <span>{audience === 'public' ? 'Everyone' : audiences[audience].label}</span>
            <ChevronDown size={13} aria-hidden="true" />
            <select
              aria-label="Post audience"
              value={audience}
              onChange={(event) => {
                audienceTouched.current = true;
                setAudience(event.target.value as Audience);
              }}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            >
              {Object.entries(audiences).map(([key, value]) => (
                <option key={key} value={key}>
                  {value.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {mediaAvailable && (
        <div
          className={clsx(
            'relative shrink-0 touch-none overflow-hidden',
            dragHeight === null && 'transition-[height] duration-300 ease-out',
          )}
          style={{ height: cameraHeight }}
          onPointerDown={dragStart}
          onPointerMove={dragMove}
          onPointerUp={dragEnd}
          onPointerCancel={dragEnd}
        >
          <CameraView
            active={cameraVisible}
            onCapture={add}
            onLibrary={() => library.current?.click()}
            disabled={atLimit}
            top={
              <div
                className={clsx(
                  'absolute inset-x-0 top-0 z-10 flex items-center justify-between px-3',
                  camera === 'full' ? 'pt-[calc(var(--top-chrome)+0.5rem)]' : 'pt-2',
                )}
              >
                {camera === 'full' ? (
                  <button
                    type="button"
                    aria-label="Close"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={onClose}
                    className="flex h-10 w-10 items-center justify-center rounded-full bg-black/40"
                  >
                    <X size={22} />
                  </button>
                ) : (
                  <span className="h-10 w-10" />
                )}
                <span aria-hidden className="h-1.5 w-10 rounded-full bg-white/70" />
                <button
                  type="button"
                  aria-label={camera === 'full' ? 'Show the post' : 'Put the camera away'}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => setCamera(camera === 'full' ? 'half' : 'hidden')}
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-black/40"
                >
                  <ChevronDown size={22} />
                </button>
              </div>
            }
          />
        </div>
      )}
      {/* Photos only: a video from the library has no known length or origin. */}
      <input
        ref={library}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(event) => {
          void addFiles(event.target.files);
          event.target.value = '';
        }}
      />

      {picking && (
        <PostFoodPicker
          onPick={(picked) => {
            setNewFood(null);
            setFood(picked);
            setRetry(0);
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  );
}

/** A food picked from Food, joined to the post's only photo when there is exactly one. */
function PickedFoodCard({
  food,
  preview,
  previewError,
  photo,
  onRemove,
  onRetry,
}: {
  food: PickedFood;
  preview: PostPreview | null;
  previewError: string | null;
  photo?: PreparedMedia;
  onRemove: () => void;
  onRetry: () => void;
}) {
  const totals = preview ? publicationMacros(preview.publication.items) : undefined;
  return (
    <div className="relative mx-4 mb-4 mt-3 overflow-hidden rounded-2xl border border-border bg-surface-raised">
      {photo && preview && (
        <div className="bg-black" style={{ aspectRatio: String(clampAspect(photo.width, photo.height)) }}>
          {photo.kind === 'video' ? (
            <video src={photo.previewUrl} muted playsInline loop autoPlay className="h-full w-full object-cover" />
          ) : (
            <img src={photo.previewUrl} alt="" className="h-full w-full object-cover" />
          )}
        </div>
      )}
      <button
        type="button"
        aria-label="Remove food"
        className={`absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full ${photo && preview ? 'bg-black/60 text-white' : 'text-ink-muted hover:bg-ink/5'}`}
        onClick={onRemove}
      >
        <X size={16} />
      </button>
      <div className="p-3">
        {!preview ? (
          previewError ? (
            <div className="pr-8">
              <ErrorNote message={previewError} />
              <button type="button" className="btn mt-2" onClick={onRetry}>
                Retry preview
              </button>
            </div>
          ) : (
            <Spinner label={food.label ? `Preparing ${food.label}…` : 'Preparing your post…'} />
          )
        ) : (
          <>
            <h3 className="mb-2 pr-8 text-sm font-semibold">{preview.publication.label}</h3>
            {food.source.kind === 'day' ? (
              <PublishedNutritionSummary totals={totals} targets={preview.publication.targets} diary />
            ) : (
              totals && (
                <MacroRings
                  kcal={totals.energyKcal}
                  proteinMg={totals.proteinG * 1000}
                  carbMg={totals.carbG * 1000}
                  fatMg={totals.fatG * 1000}
                />
              )
            )}
            <ul className="mt-3 max-h-56 divide-y divide-border overflow-y-auto text-sm">
              {preview.publication.items.map((item) => (
                <li key={item.key} className="py-2">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-medium">{item.name}</span>
                    <span className="shrink-0 text-xs text-ink-muted">
                      {item.amount === undefined ? `Per 100 ${item.unit}` : `${item.amount} ${item.unit}`}
                    </span>
                  </div>
                  <PublishedFoodMacros food={item} />
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

function AttachmentTile({
  item,
  index,
  onRemove,
  onRetry,
}: {
  item: Attachment;
  index: number;
  onRemove: () => void;
  onRetry: () => void;
}) {
  return (
    <li
      className="relative h-36 shrink-0 overflow-hidden rounded-xl bg-ink/5"
      style={{ aspectRatio: `${Math.min(1.5, Math.max(0.6, item.media.width / item.media.height))}` }}
    >
      {item.media.kind === 'video' ? (
        <video src={item.media.previewUrl} muted playsInline loop autoPlay className="h-full w-full object-cover" />
      ) : (
        <img src={item.media.previewUrl} alt={`Photo ${index + 1}`} className="h-full w-full object-cover" />
      )}
      {item.media.kind === 'video' && (
        <span className="absolute bottom-1.5 left-1.5 flex items-center gap-1 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-white">
          <Play size={10} fill="currentColor" />
          0:{String(Math.round((item.media.durationMs ?? 0) / 1000)).padStart(2, '0')}
        </span>
      )}
      {item.status !== 'done' && (
        <span className="absolute inset-0 flex items-center justify-center bg-black/35">
          {item.status === 'uploading' ? (
            <ProgressRing value={item.progress} />
          ) : (
            <button
              type="button"
              aria-label="Retry upload"
              title={item.error}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-black"
              onClick={onRetry}
            >
              <RotateCcw size={18} />
            </button>
          )}
        </span>
      )}
      <button
        type="button"
        aria-label={`Remove ${item.media.kind === 'video' ? 'video' : 'photo'} ${index + 1}`}
        className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white"
        onClick={onRemove}
      >
        <X size={15} />
      </button>
    </li>
  );
}

function ToolButton({
  label,
  onClick,
  disabled,
  pressed,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        'flex h-10 w-10 items-center justify-center rounded-full hover:bg-ink/5 disabled:opacity-30',
        pressed ? 'bg-accent/15 text-accent' : 'text-ink',
      )}
    >
      {children}
    </button>
  );
}

const RING = 2 * Math.PI * 16;
function ProgressRing({ value }: { value: number }) {
  return (
    <svg
      viewBox="0 0 40 40"
      className="h-10 w-10 -rotate-90"
      role="progressbar"
      aria-label="Uploading"
      aria-valuenow={Math.round(value * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <circle cx="20" cy="20" r="16" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="4" />
      <circle
        cx="20"
        cy="20"
        r="16"
        fill="none"
        stroke="white"
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray={RING}
        strokeDashoffset={RING * (1 - Math.max(0.04, value))}
      />
    </svg>
  );
}

/**
 * The part of the screen the keyboard leaves visible. On iOS a fixed element does not move up
 * with the keyboard, so the page sizes itself to the visual viewport to keep its toolbar above it.
 */
function useVisualViewport() {
  const [state, setState] = useState<{ height: number | string; offsetTop: number }>({
    height: '100dvh',
    offsetTop: 0,
  });
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => setState({ height: vv.height, offsetTop: vv.offsetTop });
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);
  return state;
}
