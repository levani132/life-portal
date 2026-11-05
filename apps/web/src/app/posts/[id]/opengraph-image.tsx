import { ImageResponse } from 'next/og';
import { MACRO_COLORS } from '../../../lib/macro-colors';
import { macroShares, ringArcs } from '@life-portal/shared-domain';
import type { PublicPostPreview } from '@life-portal/shared-types';
import { fetchPublicPreview } from '../../../lib/public-preview';

export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = 'A post on Life Portal';

const BG = '#0C0E14';
const INK = '#F4F5F8';
const MUTED = '#9AA3B2';
const ACCENT = '#38BDF8';
const COLORS = MACRO_COLORS;

/**
 * A font that covers the text, subset by Google Fonts to just those characters. Titles are often
 * Georgian, which the built-in font has no glyphs for. Without a user agent Google serves TTF,
 * which is what the renderer reads. A failure falls back to the built-in font.
 */
async function loadFonts(text: string) {
  const families = ['Noto+Sans:wght@700', 'Noto+Sans+Georgian:wght@700'];
  const fonts = await Promise.all(
    families.map(async (family) => {
      try {
        const css = await (
          await fetch(
            `https://fonts.googleapis.com/css2?family=${family}&text=${encodeURIComponent(text)}`,
            { signal: AbortSignal.timeout(4000) },
          )
        ).text();
        const url = css.match(/src: url\((.+?)\) format\('(?:opentype|truetype)'\)/)?.[1];
        if (!url) return null;
        const data = await (await fetch(url, { signal: AbortSignal.timeout(4000) })).arrayBuffer();
        return { name: family.split(':')[0].replace(/\+/g, ' '), data, weight: 700 as const };
      } catch {
        return null;
      }
    }),
  );
  return fonts.filter((font): font is NonNullable<typeof font> => font !== null);
}

function arcPath(cx: number, cy: number, r: number, start: number, end: number) {
  const point = (t: number) => {
    const a = t * 2 * Math.PI - Math.PI / 2;
    return `${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`;
  };
  // A full circle cannot be one arc command; draw it as two halves.
  if (end - start >= 0.999)
    return `M ${point(0)} A ${r} ${r} 0 1 1 ${point(0.5)} A ${r} ${r} 0 1 1 ${point(0.9999)}`;
  return `M ${point(start)} A ${r} ${r} 0 ${end - start > 0.5 ? 1 : 0} 1 ${point(end)}`;
}

function Rings({ macros }: { macros: NonNullable<PublicPostPreview['macros']> }) {
  const mg = {
    proteinMg: macros.proteinG * 1000,
    carbMg: macros.carbG * 1000,
    fatMg: macros.fatG * 1000,
  };
  const shares = macroShares(mg);
  const stats = [
    { key: 'protein' as const, label: 'Protein', grams: macros.proteinG },
    { key: 'carbs' as const, label: 'Carbs', grams: macros.carbG },
    { key: 'fat' as const, label: 'Fat', grams: macros.fatG },
  ];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
      <div style={{ display: 'flex', position: 'relative', width: 150, height: 150 }}>
        <svg width="150" height="150" viewBox="0 0 150 150">
          <circle cx="75" cy="75" r="62" fill="none" stroke="#252A36" strokeWidth="16" />
          {ringArcs(mg).map((arc) => (
            <path
              key={arc.key}
              d={arcPath(75, 75, 62, arc.start, arc.end)}
              fill="none"
              stroke={COLORS[arc.key]}
              strokeWidth="16"
            />
          ))}
        </svg>
        <div
          style={{
            // The renderer has no `inset`: size the overlay to the ring explicitly.
            position: 'absolute',
            top: 0,
            left: 0,
            width: 150,
            height: 150,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <span style={{ fontSize: 38, color: INK }}>{Math.round(macros.energyKcal)}</span>
          <span style={{ fontSize: 18, color: COLORS.kcal }}>kcal</span>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {stats.map((stat) => (
          <div key={stat.key} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 14, height: 14, borderRadius: 7, background: COLORS[stat.key] }} />
            <span style={{ fontSize: 26, color: INK }}>{Math.round(stat.grams)}g</span>
            <span style={{ fontSize: 22, color: MUTED }}>
              {stat.label} · {Math.round(shares[stat.key] * 100)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Brand() {
  return (
    <div style={{ display: 'flex', fontSize: 34 }}>
      <span style={{ color: INK }}>Life</span>
      <span style={{ color: ACCENT }}>Portal</span>
    </div>
  );
}

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const preview = await fetchPublicPreview(id);
  const title = preview?.title || (preview ? 'A post' : 'A post on Life Portal');
  const fonts = await loadFonts(`LifePortal ${title} ${preview?.authorName ?? ''} by kcal Protein Carbs Fat 0123456789g·% Sign in to see it`);
  const fontFamily = fonts.map((font) => font.name).join(', ') || undefined;

  return new ImageResponse(
    (
      <div style={{ display: 'flex', width: '100%', height: '100%', background: BG, fontFamily }}>
        {preview?.photoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={preview.photoUrl}
            alt=""
            width={560}
            height={630}
            style={{ width: 560, height: 630, objectFit: 'cover' }}
          />
        )}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            flex: 1,
            padding: '56px 60px',
          }}
        >
          <Brand />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <span
              style={{
                fontSize: preview?.photoUrl ? 52 : 64,
                color: INK,
                lineHeight: 1.15,
                maxHeight: 180,
                overflow: 'hidden',
              }}
            >
              {title}
            </span>
            <span style={{ fontSize: 28, color: MUTED }}>
              {preview ? `by ${preview.authorName}` : 'Sign in to see it'}
            </span>
          </div>
          {preview?.macros ? <Rings macros={preview.macros} /> : <div style={{ display: 'flex' }} />}
        </div>
      </div>
    ),
    { ...size, fonts: fonts.length ? fonts : undefined },
  );
}
