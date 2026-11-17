const { join } = require('path');

/**
 * Content globs are written out explicitly rather than via `@nx/react/tailwind`'s
 * `createGlobPatternsForDependencies`. That helper reaches into the Nx devkit, and Turbopack
 * bundles this config file's transitive requires, which drags in `@angular-devkit/architect`
 * and breaks `next build`. The workspace libraries this app pulls classes from are listed by
 * hand below — add a line when a new UI library appears.
 *
 * @type {import('tailwindcss').Config}
 */
module.exports = {
  content: [
    join(__dirname, 'src/**/*!(*.stories|*.spec).{ts,tsx,html}'),
    join(__dirname, '../../libs/**/src/**/*.{ts,tsx,html}'),
  ],
  theme: {
    extend: {
      // Spec 037: every colour is a role (`THEME_ROLES` in libs/shared/types/src/lib/theme.ts),
      // an `r g b` variable the active theme sets. Keep this list in step with it: a test fails
      // if a role is missing here.
      colors: Object.fromEntries(
        [
          'surface', 'surface-raised', 'border', 'ink', 'ink-muted', 'ink-faint',
          'accent', 'accent-hover', 'accent-solid', 'accent-solid-hover', 'on-accent',
          'success', 'success-solid', 'warning', 'warning-solid', 'danger', 'danger-solid',
          'info', 'info-solid', 'special', 'special-solid', 'fresh', 'fresh-solid',
          'macro-kcal', 'macro-protein', 'macro-carbs', 'macro-fat',
          'macro-kcal-text', 'macro-protein-text', 'macro-carbs-text', 'macro-fat-text',
          ...['push', 'pull', 'legs', 'core', 'arms', 'cardio'].flatMap((hue) => [`train-${hue}`, `train-${hue}-solid`]),
        ].map((role) => [role, `rgb(var(--${role}) / <alpha-value>)`]),
      ),
    },
  },
  plugins: [],
};
