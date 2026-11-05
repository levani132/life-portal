'use client';
import { macroShares, ringArcs } from '@life-portal/shared-domain';
import { MACRO_COLORS } from './macro-colors';
import type { FoodPost } from '@life-portal/shared-types';

/**
 * The post as a 1080×1920 Story image (spec 017), drawn in the browser from what the viewer
 * already has: nothing is uploaded or stored. Only offered where `canShareImage()` allows it.
 */
const W = 1080;
const H = 1920;
const BG = '#0C0E14';
const SURFACE = '#151924';
const INK = '#F4F5F8';
const MUTED = '#9AA3B2';
const ACCENT = '#38BDF8';
const COLORS = MACRO_COLORS;
const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans Georgian", "Noto Sans", sans-serif';

/**
 * The photo as a same-origin bitmap. Fetched fresh with CORS rather than through an <img>: the
 * post already showed it without CORS, and that cached copy would taint the canvas. R2's CORS rule
 * allows GET from the app's origins.
 */
async function loadImage(url: string): Promise<ImageBitmap | null> {
  try {
    const response = await fetch(url, { mode: 'cors', cache: 'no-store' });
    if (!response.ok) return null;
    return await createImageBitmap(await response.blob());
  } catch {
    return null;
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Lines of `text` that fit `width`, at most `max`, the last one ending in … when cut. */
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number, max: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= width) line = next;
    else {
      if (line) lines.push(line);
      line = word;
    }
    if (lines.length === max) break;
  }
  if (lines.length < max && line) lines.push(line);
  if (lines.length === max && words.join(' ') !== lines.join(' ')) {
    let last = lines[max - 1];
    while (last && ctx.measureText(`${last}…`).width > width) last = last.slice(0, -1);
    lines[max - 1] = `${last}…`;
  }
  return lines;
}

function draw(post: FoodPost, photo: ImageBitmap | null): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available.');
  const glow = ctx.createLinearGradient(0, 0, 0, H);
  glow.addColorStop(0, '#111827');
  glow.addColorStop(1, BG);
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // Brand.
  ctx.textBaseline = 'alphabetic';
  ctx.font = `700 56px ${FONT}`;
  ctx.fillStyle = INK;
  const life = ctx.measureText('Life').width;
  const total = life + ctx.measureText('Portal').width;
  ctx.fillText('Life', (W - total) / 2, 170);
  ctx.fillStyle = ACCENT;
  ctx.fillText('Portal', (W - total) / 2 + life, 170);

  // The card.
  const x = 72;
  const cardW = W - x * 2;
  const photoH = photo ? Math.min(960, Math.round(cardW / Math.max(0.8, Math.min(1.25, photo.width / photo.height)))) : 0;
  const hasMacros = !!post.totalMacros;
  const cardH = photoH + 420 + (hasMacros ? 330 : 0);
  // Centred between the brand and the footer, so a card without a photo is not stranded at the top.
  let y = Math.max(250, Math.round((H - cardH) / 2));
  ctx.save();
  roundRect(ctx, x, y, cardW, cardH, 48);
  ctx.fillStyle = SURFACE;
  ctx.fill();
  ctx.clip();
  if (photo) {
    const scale = Math.max(cardW / photo.width, photoH / photo.height);
    const w = photo.width * scale;
    const h = photo.height * scale;
    ctx.drawImage(photo, x + (cardW - w) / 2, y + (photoH - h) / 2, w, h);
  }
  ctx.restore();
  y += photoH + 100;

  // Author and title.
  const pad = x + 56;
  const inner = cardW - 112;
  ctx.fillStyle = MUTED;
  ctx.font = `500 36px ${FONT}`;
  ctx.fillText(post.author.displayName, pad, y);
  y += 84;
  ctx.fillStyle = INK;
  ctx.font = `700 64px ${FONT}`;
  const title = post.title || post.contentLabel || post.caption || 'A post';
  for (const line of wrap(ctx, title, inner, 3)) {
    ctx.fillText(line, pad, y);
    y += 78;
  }

  // Macro rings.
  if (post.totalMacros) {
    const m = post.totalMacros;
    const mg = { proteinMg: m.proteinG * 1000, carbMg: m.carbG * 1000, fatMg: m.fatG * 1000 };
    const shares = macroShares(mg);
    const cx = pad + 120;
    const cy = y + 120;
    ctx.lineWidth = 30;
    ctx.lineCap = 'butt';
    ctx.strokeStyle = '#252A36';
    ctx.beginPath();
    ctx.arc(cx, cy, 105, 0, Math.PI * 2);
    ctx.stroke();
    for (const arc of ringArcs(mg)) {
      ctx.strokeStyle = COLORS[arc.key];
      ctx.beginPath();
      ctx.arc(cx, cy, 105, arc.start * 2 * Math.PI - Math.PI / 2, arc.end * 2 * Math.PI - Math.PI / 2);
      ctx.stroke();
    }
    ctx.textAlign = 'center';
    ctx.fillStyle = INK;
    ctx.font = `700 64px ${FONT}`;
    ctx.fillText(Math.round(m.energyKcal).toLocaleString(), cx, cy + 14);
    ctx.fillStyle = COLORS.kcal;
    ctx.font = `500 30px ${FONT}`;
    ctx.fillText('kcal', cx, cy + 56);
    ctx.textAlign = 'left';
    const stats = [
      ['protein', 'Protein', m.proteinG],
      ['carbs', 'Carbs', m.carbG],
      ['fat', 'Fat', m.fatG],
    ] as const;
    stats.forEach(([key, label, grams], index) => {
      const sy = cy - 70 + index * 80;
      const sx = cx + 190;
      ctx.fillStyle = COLORS[key];
      ctx.beginPath();
      ctx.arc(sx + 12, sy - 14, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = INK;
      ctx.font = `700 46px ${FONT}`;
      ctx.fillText(`${Math.round(grams)}g`, sx + 44, sy);
      const gw = ctx.measureText(`${Math.round(grams)}g`).width;
      ctx.fillStyle = MUTED;
      ctx.font = `500 32px ${FONT}`;
      ctx.fillText(`${label} · ${Math.round(shares[key] * 100)}%`, sx + 62 + gw, sy);
    });
  }

  // Footer.
  ctx.textAlign = 'center';
  ctx.fillStyle = MUTED;
  ctx.font = `500 34px ${FONT}`;
  ctx.fillText('Shared from Life Portal', W / 2, H - 150);
  return canvas;
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not draw the image.'))), 'image/png'),
  );
}

/** The Story image as a PNG file. A photo the browser will not let us export is left out. */
export async function renderShareImage(post: FoodPost): Promise<File> {
  const media = post.media.find((m) => m.kind === 'image') ?? post.media[0];
  const source = media ? (media.kind === 'video' ? media.posterUrl : media.url) : undefined;
  const photo = source ? await loadImage(source) : null;
  let blob: Blob;
  try {
    blob = await toBlob(draw(post, photo));
  } catch (error) {
    // A tainted canvas (no CORS on the photo) refuses to export: draw it without the photo.
    if (!photo) throw error;
    blob = await toBlob(draw(post, null));
  }
  return new File([blob], `life-portal-${post.id}.png`, { type: 'image/png' });
}

/**
 * Hands the image to the phone's share sheet (Instagram and TikTok take it as a Story or post),
 * or downloads it where files cannot be shared.
 */
export async function shareImageFile(file: File, title: string): Promise<'shared' | 'saved' | 'cancelled'> {
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return 'shared';
    } catch (error) {
      if ((error as Error).name === 'AbortError') return 'cancelled';
      // NotAllowedError: the tap's permission ran out. Fall through to saving it.
    }
  }
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'saved';
}
