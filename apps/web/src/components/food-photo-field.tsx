'use client';
import { useEffect, useRef, useState } from 'react';
import { ImagePlus, Trash2 } from 'lucide-react';
import type { FoodImage, MediaConfig } from '@life-portal/shared-types';
import { useApi } from '../lib/hooks';
import { prepareImage, uploadMedia } from '../lib/media';

/** What saving the form should do with the food's photo. */
export type FoodPhotoChange =
  | { kind: 'keep' }
  | { kind: 'remove' }
  | { kind: 'uploading' }
  | { kind: 'new'; mediaId: string };

/** The fields a food's create or update needs for a photo change. */
export function foodPhotoPayload(change: FoodPhotoChange) {
  if (change.kind === 'new') return { imageMediaId: change.mediaId };
  if (change.kind === 'remove') return { removeImage: true };
  return {};
}

/**
 * A food's photo in the Food form: shows the current one, uploads a replacement the moment it is
 * chosen, or removes it. The server copies the upload onto the food when the form is saved.
 */
export function FoodPhotoField({
  image,
  onChange,
  hint = 'Shown with the food in your list and in posts.',
}: {
  image?: FoodImage;
  onChange: (change: FoodPhotoChange) => void;
  /** The line under "Photo". The training forms reuse this field for exercises and machines. */
  hint?: string;
}) {
  const config = useApi<MediaConfig>('/media/config');
  const [preview, setPreview] = useState<string | undefined>(image?.url);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  if (!config.data?.available) return null;

  async function choose(file: File) {
    setError(null);
    abort.current?.abort();
    abort.current = new AbortController();
    try {
      const media = await prepareImage(file);
      setPreview(media.previewUrl);
      setProgress(0);
      onChange({ kind: 'uploading' });
      const mediaId = await uploadMedia(media, setProgress, abort.current.signal);
      setProgress(null);
      onChange({ kind: 'new', mediaId });
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      setProgress(null);
      setPreview(image?.url);
      setError(e instanceof Error ? e.message : 'Could not upload the photo.');
      onChange({ kind: 'keep' });
    }
  }

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={() => input.current?.click()}
        className="relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-dashed border-border bg-surface text-ink-muted"
        aria-label={preview ? 'Change photo' : 'Add a photo'}
      >
        {preview ? (
          <img src={preview} alt="" className="h-full w-full object-cover" />
        ) : (
          <ImagePlus size={22} />
        )}
        {progress !== null && (
          <span className="absolute inset-0 flex items-center justify-center bg-black/45 text-xs font-semibold text-white">
            {Math.round(progress * 100)}%
          </span>
        )}
      </button>
      <div className="min-w-0 text-sm">
        <p className="font-medium">Photo</p>
        <p className="text-xs text-ink-muted">{hint}</p>
        {preview && progress === null && (
          <button
            type="button"
            className="mt-1 inline-flex items-center gap-1 text-xs text-rose-400"
            onClick={() => {
              abort.current?.abort();
              setPreview(undefined);
              onChange(image ? { kind: 'remove' } : { kind: 'keep' });
            }}
          >
            <Trash2 size={12} /> Remove
          </button>
        )}
        {error && <p className="mt-1 text-xs text-rose-400">{error}</p>}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void choose(file);
        }}
      />
    </div>
  );
}
