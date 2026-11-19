/** @jest-environment node */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { THEME_ROLES, THEME_V0 } from '@life-portal/shared-types';

/**
 * Spec 037: every colour on the page is a role. These tests keep the three places that name the
 * roles in step (the shared list, the stylesheet's built-in v0, Tailwind) and stop a raw colour
 * from coming back into a component.
 */
const WEB = join(__dirname, '..', '..');
const SRC = join(WEB, 'src');

function block(css: string, start: string): Record<string, string> {
  const from = css.indexOf(start);
  expect(from).toBeGreaterThanOrEqual(0);
  const body = css.slice(from, css.indexOf('}', from));
  const values: Record<string, string> = {};
  for (const match of body.matchAll(/--([a-z-]+): (\d{1,3} \d{1,3} \d{1,3});/g)) values[match[1]] = match[2];
  return values;
}

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.tsx?$/.test(name) && !/\.spec\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('colour roles', () => {
  const css = readFileSync(join(SRC, 'app', 'global.css'), 'utf8');

  it('the stylesheet declares v0 exactly, for light, dark and system-dark', () => {
    expect(block(css, ':root {')).toEqual(THEME_V0.light);
    expect(block(css, ":root[data-theme='dark'] {")).toEqual(THEME_V0.dark);
    expect(block(css, ":root:not([data-theme='light']) {")).toEqual(THEME_V0.dark);
  });

  it('Tailwind exposes every role', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const config = require(join(WEB, 'tailwind.config.js'));
    const colors = config.theme.extend.colors as Record<string, string>;
    for (const role of THEME_ROLES) expect(colors[role.id]).toBe(`rgb(var(--${role.id}) / <alpha-value>)`);
  });

  /**
   * Places a fixed colour is right, each for a reason: text on a white button over a gradient,
   * other companies' brand colours, the camera's record red, rank materials, and images made
   * for outside the page (canvas, link preview, manifest), which cannot read a variable.
   */
  const PALETTE_ALLOWED: Record<string, number> = {
    'components/food-day.tsx': 4,
    'components/post-share-sheet.tsx': 6,
    'components/training/plan-suggestions.tsx': 1,
    'components/training/workout-session.tsx': 1,
  };
  const LITERAL_ALLOWED = new Set([
    'app/layout.tsx',
    'app/manifest.ts',
    'app/posts/[id]/opengraph-image.tsx',
    'components/google-button.tsx',
    'components/log-food-modal.tsx',
    'components/post-camera.tsx',
    'components/post-composer.tsx',
    'components/post-share-sheet.tsx',
    'components/theme-preference.tsx',
    'components/training/muscle-figure.tsx',
    'components/training/rank-emblem.tsx',
    'lib/macro-colors.ts',
    // The white square a brand logo is drawn on before upload: a stored picture, not the page.
    'lib/media.ts',
    'lib/share-image.ts',
  ]);
  const PALETTE =
    /\b(?:text|bg|border|ring|from|to|via|fill|stroke|shadow|divide|outline|decoration|caret|placeholder|accent)-(?:[lrtbxy]-)?(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}/g;
  const LITERAL = /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b(?![\w-])|rgba?\(\s*\d/;

  it('no component names a palette colour or a literal outside the listed exceptions', () => {
    const palette: Record<string, number> = {};
    const literal: string[] = [];
    for (const path of files(SRC)) {
      const name = path.slice(SRC.length + 1).split('\\').join('/');
      const text = readFileSync(path, 'utf8');
      const count = text.match(PALETTE)?.length ?? 0;
      if (count) palette[name] = count;
      // A link's "#fragment" is not a colour.
      const lines = text.split('\n').filter((line) => LITERAL.test(line.replace(/https?:\/\/\S+/g, '')));
      if (lines.length && !LITERAL_ALLOWED.has(name)) literal.push(name);
    }
    expect(palette).toEqual(PALETTE_ALLOWED);
    expect(literal).toEqual([]);
  });
});
