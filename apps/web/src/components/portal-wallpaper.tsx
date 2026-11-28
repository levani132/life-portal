'use client';

import clsx from 'clsx';
import { Check, ImagePlus, Trash2 } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { PORTAL_WALLPAPERS, type MediaConfig, type PortalWallpaper } from '@life-portal/shared-types';
import { api } from '../lib/api';
import { revalidate, useApi } from '../lib/hooks';
import { prepareWallpaper, uploadMedia } from '../lib/media';
import { THEME_APPLIED_EVENT } from '../lib/theme-runtime';
import { ErrorNote, Modal } from './ui';

/** Where a wallpaper's picture is: a preset ships with the app, an own photo is a signed link. */
export function wallpaperSrc(wallpaper: PortalWallpaper): string {
  return 'preset' in wallpaper ? `/wallpapers/${wallpaper.preset}.jpg` : wallpaper.url;
}

/** Only one portal is on screen at a time; this is the one whose wallpaper owns the chrome. */
let chromeOwner: symbol | null = null;

/**
 * The portal's wallpaper (spec 048), fixed behind the whole screen like a phone's home screen.
 * While it is on screen the app's header turns see-through (`html[data-wallpaper]`), so on an
 * iPhone it runs under the status bar too; Android cannot draw there, so its status bar takes the
 * picture's top colour instead (`data-wallpaper-top`, read by `ThemeSync`). A veil of the theme's
 * own surface darkens (or, in light mode, lightens) the picture towards the bottom and as the page
 * scrolls, so text over it stays readable whatever the photo.
 *
 * The picture itself is drawn on `<body>`, not where the component sits: pull-to-refresh and tab
 * swipes move the page with a transform, and a transform would carry a `fixed` picture along with
 * it (the pull showed the page's background above a dragged wallpaper). Only a marker stays here,
 * to tell whether this portal is the one on screen.
 */
export function PortalWallpaperLayer({
  wallpaper,
  variant = 'screen',
}: {
  wallpaper: PortalWallpaper;
  /**
   * `screen`: a portal. `band`: Home (owner, 2026-11-28): the same fixed picture, but Home's feed
   * keeps its own look (its section is solid and slides over the picture), so posts are not
   * turned to glass (`data-wallpaper="band"` instead of `"on"`).
   */
  variant?: 'screen' | 'band';
}) {
  const host = useRef<HTMLSpanElement>(null);
  const [onScreen, setOnScreen] = useState(false);
  const dim = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const src = wallpaperSrc(wallpaper);
  const [top, setTop] = useState<string | undefined>(() =>
    'preset' in wallpaper ? PORTAL_WALLPAPERS.find((each) => each.id === wallpaper.preset)?.top : undefined,
  );

  // An own photo's top colour is measured once it loads (with CORS, so the canvas may read it).
  useEffect(() => {
    if ('preset' in wallpaper) {
      setTop(PORTAL_WALLPAPERS.find((each) => each.id === wallpaper.preset)?.top);
      return;
    }
    let cancelled = false;
    void topColour(wallpaper.url).then((colour) => {
      if (!cancelled) setTop(colour);
    });
    return () => {
      cancelled = true;
    };
  }, [wallpaper]);

  // The chrome follows whether this portal is the one on screen: a kept tab that is hidden is
  // `inert`, so its wallpaper must not touch the header or the status bar.
  useEffect(() => {
    const token = Symbol('wallpaper');
    const root = document.documentElement;
    const sync = () => {
      const node = host.current;
      const visible = !!node && !node.closest('[inert]');
      setOnScreen(visible);
      if (visible) {
        chromeOwner = token;
        // `on` also turns the portal's posts to glass; Home's band leaves its feed as it is.
        root.dataset.wallpaper = variant === 'band' ? 'band' : 'on';
        if (top) root.dataset.wallpaperTop = top;
        else delete root.dataset.wallpaperTop;
      } else if (chromeOwner === token) {
        chromeOwner = null;
        delete root.dataset.wallpaper;
        delete root.dataset.wallpaperTop;
      }
      window.dispatchEvent(new Event(THEME_APPLIED_EVENT));
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { attributes: true, attributeFilter: ['inert'], subtree: true });
    return () => {
      observer.disconnect();
      if (chromeOwner === token) {
        chromeOwner = null;
        delete root.dataset.wallpaper;
        delete root.dataset.wallpaperTop;
        window.dispatchEvent(new Event(THEME_APPLIED_EVENT));
      }
    };
  }, [top, pathname, variant]);

  // The further down the page, the stronger the veil: posts are read over a quiet background.
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      if (dim.current) dim.current.style.opacity = String(Math.min(0.7, Math.max(0, window.scrollY) / 700));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [onScreen]);

  return (
    <>
      <span ref={host} hidden />
      {onScreen &&
        createPortal(
          <div aria-hidden className="pointer-events-none fixed inset-0 -z-20 overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element -- a signed, expiring link; next/image would cache it. */}
            <img src={src} alt="" className="absolute inset-0 h-full w-full object-cover object-top" decoding="async" />
            <div className="absolute inset-0 bg-gradient-to-b from-surface/10 via-surface/30 to-surface/80" />
            <div ref={dim} className="absolute inset-0 bg-surface" style={{ opacity: 0 }} />
          </div>,
          document.body,
        )}
    </>
  );
}

/** The average colour of a picture's top edge, or nothing when it cannot be read. */
async function topColour(url: string): Promise<string | undefined> {
  try {
    const response = await fetch(url, { mode: 'cors', cache: 'no-store' });
    if (!response.ok) return undefined;
    const bitmap = await createImageBitmap(await response.blob());
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 2;
    const context = canvas.getContext('2d');
    if (!context) return undefined;
    context.drawImage(bitmap, 0, 0, bitmap.width, Math.max(1, Math.round(bitmap.height * 0.03)), 0, 0, 32, 2);
    bitmap.close();
    const data = context.getImageData(0, 0, 32, 2).data;
    const sum = [0, 0, 0];
    for (let i = 0; i < data.length; i += 4) for (let c = 0; c < 3; c++) sum[c] += data[i + c];
    const count = data.length / 4;
    return `#${sum.map((value) => Math.round(value / count).toString(16).padStart(2, '0')).join('')}`;
  } catch {
    return undefined;
  }
}

/**
 * Choosing the wallpaper: the ten drawn for the app, your own photo, or none. A photo is scaled
 * down and re-encoded on the device (which strips its location), then checked like a profile
 * photo before anyone sees it.
 */
export function WallpaperPicker({ open, current, onClose }: { open: boolean; current?: PortalWallpaper; onClose: () => void }) {
  const config = useApi<MediaConfig>(open ? '/media/config' : null);
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = progress !== null;
  const chosen = current && 'preset' in current ? current.preset : current ? 'own' : null;

  async function save(body: { preset: string } | { mediaId: string } | null) {
    setError(null);
    try {
      if (body) await api.put('/social/me/wallpaper', body);
      else await api.delete('/social/me/wallpaper');
      await revalidate('/social');
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not change the wallpaper.');
    }
  }
  async function upload(file: File) {
    setError(null);
    try {
      const media = await prepareWallpaper(file);
      URL.revokeObjectURL(media.previewUrl);
      setProgress(0);
      const mediaId = await uploadMedia(media, setProgress, new AbortController().signal);
      await save({ mediaId });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not upload the photo.');
    } finally {
      setProgress(null);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Wallpaper" wide>
      <p className="mb-3 text-sm text-ink-muted">Shown behind your portal to everyone who can open it, like your profile photo.</p>
      <ul className="grid grid-cols-4 gap-2 sm:grid-cols-5">
        {PORTAL_WALLPAPERS.map((each) => (
          <li key={each.id}>
            <button
              type="button"
              disabled={busy}
              aria-pressed={chosen === each.id}
              aria-label={each.label}
              className={clsx(
                'relative block aspect-[9/19] w-full overflow-hidden rounded-xl border-2 transition active:scale-95',
                chosen === each.id ? 'border-accent-solid' : 'border-transparent',
              )}
              onClick={() => void save({ preset: each.id })}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- a small static file. */}
              <img src={`/wallpapers/${each.id}.jpg`} alt="" loading="lazy" className="h-full w-full object-cover object-top" />
              {chosen === each.id && (
                <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-accent-solid text-on-accent">
                  <Check size={12} />
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {config.data?.available && (
          <>
            <button type="button" className="btn-primary" disabled={busy} onClick={() => input.current?.click()}>
              <ImagePlus size={16} aria-hidden />
              {busy ? `Uploading… ${Math.round((progress ?? 0) * 100)}%` : chosen === 'own' ? 'Choose another photo' : 'Use your own photo'}
            </button>
            <input
              ref={input}
              type="file"
              accept="image/*"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) void upload(file);
              }}
            />
          </>
        )}
        {current && (
          <button type="button" className="btn-ghost" disabled={busy} onClick={() => void save(null)}>
            <Trash2 size={16} aria-hidden />
            No wallpaper
          </button>
        )}
      </div>
      {error && <ErrorNote message={error} />}
    </Modal>
  );
}
