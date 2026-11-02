'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, Globe, Lock, Users } from 'lucide-react';
import type {
  Audience,
  PostPreview,
  PostSelection,
} from '@life-portal/shared-types';
import { publicationMacros } from '@life-portal/shared-domain';
import { api } from '../lib/api';
import { revalidate } from '../lib/hooks';
import { splitPostDraft } from '../lib/post-draft';
import {
  PublishedFoodMacros,
  PublishedNutritionSummary,
} from './published-nutrition';
import { ErrorNote, Modal, Spinner } from './ui';

const audiences = {
  private: { label: 'Only me', icon: Lock },
  friends: { label: 'Friends', icon: Users },
  public: { label: 'Everyone in Life Portal', icon: Globe },
};
export function PostComposer({
  onClose,
  initialSource: source,
  defaultAudience = 'private',
}: {
  onClose: () => void;
  initialSource: PostSelection;
  defaultAudience?: Audience;
}) {
  const [preview, setPreview] = useState<PostPreview | null>(null);
  const [draft, setDraft] = useState({ title: '', caption: '' });
  const [captionOnly, setCaptionOnly] = useState(false);
  const [audience, setAudience] = useState<Audience>(defaultAudience);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [requestId] = useState(() => crypto.randomUUID());
  const titleInput = useRef<HTMLTextAreaElement>(null);
  const captionInput = useRef<HTMLTextAreaElement>(null);
  const router = useRouter();
  useEffect(() => {
    let active = true;
    setError(null);
    void api
      .post<PostPreview>('/posts/preview', { source })
      .then((result) => {
        if (active) setPreview(result);
      })
      .catch((e: unknown) => {
        if (active)
          setError(
            e instanceof Error ? e.message : 'Could not prepare this post.',
          );
      });
    return () => {
      active = false;
    };
  }, [source, retry]);
  function focusCaption() {
    requestAnimationFrame(() => {
      const input = captionInput.current;
      input?.focus();
      input?.setSelectionRange(input.value.length, input.value.length);
    });
  }
  async function publish() {
    if (!preview || pending) return;
    setPending(true);
    setError(null);
    try {
      const post = await api.post<{ id: string }>('/posts', {
        source,
        title: draft.title.trim(),
        caption: draft.caption.trim(),
        audience,
        previewHash: preview.previewHash,
        requestId,
      });
      await revalidate('/posts');
      onClose();
      router.push(`/posts/${post.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not publish.');
    } finally {
      setPending(false);
    }
  }
  const AudienceIcon = audiences[audience].icon;
  return (
    <Modal open onClose={onClose} title="Share post" wide>
      {error && <ErrorNote message={error} />}
      {error && preview && (
        <button
          type="button"
          className="btn-ghost mb-3"
          disabled={pending}
          onClick={() => {
            setPreview(null);
            setRetry((value) => value + 1);
          }}
        >
          Refresh preview
        </button>
      )}
      {!preview ? (
        error ? (
          <button
            type="button"
            className="btn"
            onClick={() => setRetry((value) => value + 1)}
          >
            Retry preview
          </button>
        ) : (
          <Spinner label="Preparing your post…" />
        )
      ) : (
        <>
          <fieldset
            disabled={pending}
            className="overflow-hidden rounded-2xl border border-border"
          >
            <div className="space-y-2 p-4">
              {!captionOnly && (
                <textarea
                  ref={titleInput}
                  rows={1}
                  maxLength={1000}
                  aria-label="Post title"
                  placeholder="Write a title…"
                  value={draft.title}
                  className="w-full resize-none border-0 bg-transparent text-lg font-semibold text-ink outline-none placeholder:text-ink-faint"
                  onKeyDown={(event) => {
                    if (
                      event.key === 'Enter' &&
                      !event.nativeEvent.isComposing
                    ) {
                      event.preventDefault();
                      if (!draft.title) setCaptionOnly(true);
                      focusCaption();
                    }
                  }}
                  onChange={(event) => {
                    const value = event.target.value;
                    event.currentTarget.style.height = 'auto';
                    event.currentTarget.style.height = `${Math.max(28, event.currentTarget.scrollHeight)}px`;
                    const next = splitPostDraft(
                      value + (draft.caption ? `\n${draft.caption}` : ''),
                    );
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
                placeholder={
                  captionOnly ? 'Write your post…' : 'Add a caption…'
                }
                value={draft.caption}
                className="w-full resize-y border-0 bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    caption: event.target.value,
                  }))
                }
              />
            </div>
            <div className="mx-3 mb-3 rounded-xl bg-surface p-3 ring-1 ring-border/60">
              <h3 className="text-sm font-semibold">
                {preview.publication.label}
              </h3>
              <PublishedNutritionSummary
                totals={publicationMacros(preview.publication.items)}
                targets={preview.publication.targets}
                diary={source.kind === 'day'}
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
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-2">
              <span className="text-[11px] text-ink-muted">
                {captionOnly ? (
                  <button
                    type="button"
                    className="underline"
                    onClick={() => {
                      setCaptionOnly(false);
                      requestAnimationFrame(() => titleInput.current?.focus());
                    }}
                  >
                    Add a title
                  </button>
                ) : (
                  'Enter adds a caption · Long titles become captions'
                )}
              </span>
              <div
                className="relative flex h-9 w-12 shrink-0 items-center justify-center gap-1 rounded-lg hover:bg-violet-500/10 focus-within:ring-2 focus-within:ring-accent"
                title={audiences[audience].label}
              >
                <AudienceIcon size={17} aria-hidden="true" />
                <ChevronDown size={12} aria-hidden="true" />
                <select
                  aria-label="Post audience"
                  value={audience}
                  onChange={(event) =>
                    setAudience(event.target.value as Audience)
                  }
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
          </fieldset>
          {source.kind === 'day' && (
            <p className="mt-2 text-xs text-ink-muted">
              Includes the displayed daily targets.
            </p>
          )}
          {draft.caption.length > 1000 && (
            <p role="alert" className="mt-2 text-xs text-rose-400">
              Keep the caption within 1,000 characters.
            </p>
          )}
          <div className="mt-4 flex items-center justify-between gap-3">
            <p className="text-xs text-ink-muted">
              Sharing with: {audiences[audience].label}
            </p>
            <button
              type="button"
              className="btn-primary"
              disabled={pending || draft.caption.length > 1000}
              onClick={() => void publish()}
            >
              {pending
                ? 'Posting…'
                : audience === 'private'
                  ? 'Post for only me'
                  : 'Publish post'}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
