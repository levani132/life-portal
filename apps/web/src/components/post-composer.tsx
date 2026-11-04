'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import clsx from 'clsx';
import {
  Camera,
  ChevronDown,
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
  type MediaConfig,
  type NutritionProfile,
  type PostPreview,
  type PostSelection,
} from '@life-portal/shared-types';
import { postHasContent, publicationMacros } from '@life-portal/shared-domain';
import { api } from '../lib/api';
import { revalidate, useApi } from '../lib/hooks';
import { prepareImage, uploadMedia, type PreparedMedia } from '../lib/media';
import { splitPostDraft } from '../lib/post-draft';
import { PostCamera } from './post-camera';
import { PostFoodPicker, type PickedFood } from './post-food-picker';
import {
  PublishedFoodMacros,
  PublishedNutritionSummary,
} from './published-nutrition';
import { ErrorNote, Spinner } from './ui';
import { requestNotificationOffer } from './notifications';

const audiences = {
  private: { label: 'Only me', icon: Lock },
  friends: { label: 'Friends', icon: Users },
  public: { label: 'Everyone in Life Portal', icon: Globe },
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

/**
 * The one place a post is written. Opened from the header's + (empty) or from a share button in
 * Food (with that selection attached). Text, photos and videos and one Food attachment can be
 * combined; any one of them is enough to post.
 *
 * Uploads start the moment a photo is added and run while the person writes, so Share is
 * usually instant. The food attachment is previewed exactly as the server will publish it.
 */
export function PostComposer({
  onClose,
  initialSource,
  defaultAudience,
}: {
  onClose: () => void;
  initialSource?: PostSelection;
  defaultAudience?: Audience;
}) {
  const [food, setFood] = useState<PickedFood | null>(
    initialSource ? { source: initialSource, label: '' } : null,
  );
  const [preview, setPreview] = useState<PostPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [draft, setDraft] = useState({ title: '', caption: '' });
  const [captionOnly, setCaptionOnly] = useState(false);
  const [audience, setAudience] = useState<Audience>(defaultAudience ?? 'friends');
  const audienceTouched = useRef(!!defaultAudience);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [picking, setPicking] = useState(false);
  const [camera, setCamera] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestId] = useState(() => crypto.randomUUID());
  const titleInput = useRef<HTMLTextAreaElement>(null);
  const captionInput = useRef<HTMLTextAreaElement>(null);
  const library = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const viewport = useVisualViewport();
  const mediaConfig = useApi<MediaConfig>('/posts/media/config');
  const mediaAvailable = !!mediaConfig.data?.available;
  // Opened from the header there is no Food page to say who posts are for: ask the profile.
  const profile = useApi<{ profile: NutritionProfile }>(
    defaultAudience ? null : '/nutrition/profile',
  );
  useEffect(() => {
    const preferred = profile.data?.profile.defaultFoodVisibility;
    if (preferred && !audienceTouched.current) setAudience(preferred);
  }, [profile.data]);

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

  // Close with Escape; abandon uploads when the composer goes away.
  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !picking && !camera) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, picking, camera]);
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
    uploadMedia(
      item.media,
      (progress) => update(item.localId, { progress }),
      item.abort.signal,
    )
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
      const item: Attachment = {
        localId: crypto.randomUUID(),
        media,
        status: 'uploading',
        progress: 0,
        abort: new AbortController(),
      };
      setAttachments((items) => [...items, item]);
      startUpload(item);
    },
    [startUpload],
  );
  async function addFiles(files: FileList | null) {
    if (!files) return;
    const room = MAX_POST_MEDIA - attachments.length;
    const chosen = Array.from(files).filter((file) => file.type.startsWith('image/') || !file.type);
    if (chosen.length > room)
      setError(`A post can have up to ${MAX_POST_MEDIA} photos and videos.`);
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
  const hasContent = postHasContent({
    title: draft.title,
    caption: draft.caption,
    mediaCount: attachments.length,
    hasFood: !!food,
  });
  const ready =
    hasContent &&
    !uploading &&
    !failed &&
    (!food || !!preview) &&
    draft.caption.length <= 1000 &&
    !pending;

  async function publish() {
    if (!ready) return;
    setPending(true);
    setError(null);
    try {
      const post = await api.post<{ id: string }>('/posts', {
        ...(food && preview ? { source: food.source, previewHash: preview.previewHash } : {}),
        ...(attachments.length ? { mediaIds: attachments.map((item) => item.id) } : {}),
        title: draft.title.trim(),
        caption: draft.caption.trim(),
        audience,
        requestId,
      });
      await revalidate('/posts');
      onClose();
      router.push(`/posts/${post.id}`);
      requestNotificationOffer('post');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not publish.');
    } finally {
      setPending(false);
    }
  }

  const AudienceIcon = audiences[audience].icon;
  const atLimit = attachments.length >= MAX_POST_MEDIA;
  return (
    <div
      className="fixed inset-x-0 top-0 z-50 flex flex-col bg-surface"
      style={{ height: viewport.height, transform: `translateY(${viewport.offsetTop}px)` }}
      role="dialog"
      aria-modal="true"
      aria-label="New post"
      data-no-tab-swipe
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-2 pb-2 pt-[calc(env(safe-area-inset-top)+0.5rem)]">
        <button
          type="button"
          aria-label="Close"
          className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-ink/5"
          onClick={onClose}
        >
          <X size={22} />
        </button>
        <h2 className="flex-1 text-center text-base font-semibold">New post</h2>
        <button
          type="button"
          className="rounded-full bg-accent px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
          disabled={!ready}
          onClick={() => void publish()}
        >
          {pending ? 'Sharing…' : uploading ? 'Uploading…' : 'Share'}
        </button>
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
            rows={captionOnly ? 5 : 3}
            maxLength={1000}
            aria-label="Post caption"
            placeholder={captionOnly ? 'What’s happening?' : 'Write something…'}
            value={draft.caption}
            className="w-full resize-none border-0 bg-transparent text-[15px] leading-relaxed text-ink outline-none placeholder:text-ink-faint"
            onChange={(event) =>
              setDraft((current) => ({ ...current, caption: event.target.value }))
            }
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

        {attachments.length > 0 && (
          <ul
            className="no-scrollbar mt-3 flex gap-2 overflow-x-auto px-4 pb-1"
            aria-label="Photos and videos"
          >
            {attachments.map((item, index) => (
              <li
                key={item.localId}
                className="relative h-36 shrink-0 overflow-hidden rounded-xl bg-ink/5"
                style={{
                  aspectRatio: `${Math.min(1.5, Math.max(0.6, item.media.width / item.media.height))}`,
                }}
              >
                {item.media.kind === 'video' ? (
                  <video
                    src={item.media.previewUrl}
                    muted
                    playsInline
                    loop
                    autoPlay
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <img
                    src={item.media.previewUrl}
                    alt={`Photo ${index + 1}`}
                    className="h-full w-full object-cover"
                  />
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
                        onClick={() => {
                          const next = { ...item, abort: new AbortController() };
                          setAttachments((items) =>
                            items.map((i) => (i.localId === item.localId ? next : i)),
                          );
                          startUpload(next);
                        }}
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
                  onClick={() => remove(item.localId)}
                >
                  <X size={15} />
                </button>
              </li>
            ))}
          </ul>
        )}

        {food && (
          <div className="relative mx-4 mb-4 mt-3 rounded-xl bg-surface-raised p-3 ring-1 ring-border/60">
            <button
              type="button"
              aria-label="Remove food"
              className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full text-ink-muted hover:bg-ink/5"
              onClick={() => setFood(null)}
            >
              <X size={16} />
            </button>
            {!preview ? (
              previewError ? (
                <div className="pr-8">
                  <ErrorNote message={previewError} />
                  <button
                    type="button"
                    className="btn mt-2"
                    onClick={() => setRetry((value) => value + 1)}
                  >
                    Retry preview
                  </button>
                </div>
              ) : (
                <Spinner label={food.label ? `Preparing ${food.label}…` : 'Preparing your post…'} />
              )
            ) : (
              <>
                <h3 className="pr-8 text-sm font-semibold">{preview.publication.label}</h3>
                <PublishedNutritionSummary
                  totals={publicationMacros(preview.publication.items)}
                  targets={preview.publication.targets}
                  diary={food.source.kind === 'day'}
                />
                <ul className="mt-3 max-h-64 divide-y divide-border overflow-y-auto text-sm">
                  {preview.publication.items.map((item) => (
                    <li key={item.key} className="py-2">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="font-medium">{item.name}</span>
                        <span className="shrink-0 text-xs text-ink-muted">
                          {item.amount === undefined
                            ? `Per 100 ${item.unit}`
                            : `${item.amount} ${item.unit}`}
                        </span>
                      </div>
                      <PublishedFoodMacros food={item} />
                    </li>
                  ))}
                </ul>
                {food.source.kind === 'day' && (
                  <p className="mt-2 text-xs text-ink-muted">Includes the displayed daily targets.</p>
                )}
              </>
            )}
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1 border-t border-border px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2">
        <ToolButton
          label={food ? 'Replace the food' : 'Add from Food'}
          onClick={() => setPicking(true)}
        >
          <Plus size={22} />
        </ToolButton>
        {mediaAvailable && (
          <>
            <ToolButton
              label="Add photos"
              disabled={atLimit}
              onClick={() => library.current?.click()}
            >
              <ImagePlus size={21} />
            </ToolButton>
            <ToolButton label="Camera" disabled={atLimit} onClick={() => setCamera(true)}>
              <Camera size={21} />
            </ToolButton>
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

      {picking && (
        <PostFoodPicker
          onPick={(picked) => {
            setFood(picked);
            setRetry(0);
          }}
          onClose={() => setPicking(false)}
        />
      )}
      {camera && <PostCamera onCapture={add} onClose={() => setCamera(false)} />}
    </div>
  );
}

function ToolButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        'flex h-10 w-10 items-center justify-center rounded-full text-ink hover:bg-ink/5 disabled:opacity-30',
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
 * with the keyboard, so the composer sizes itself to the visual viewport to keep its toolbar
 * above it.
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
