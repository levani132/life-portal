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
      colors: {
        // Semantic tokens, so a card's colour is chosen by meaning rather than by hue.
        surface: 'rgb(var(--surface) / <alpha-value>)',
        'surface-raised': 'rgb(var(--surface-raised) / <alpha-value>)',
        border: 'rgb(var(--border) / <alpha-value>)',
        ink: 'rgb(var(--ink) / <alpha-value>)',
        'ink-muted': 'rgb(var(--ink-muted) / <alpha-value>)',
        'ink-faint': 'rgb(var(--ink-faint) / <alpha-value>)',
      },
    },
  },
  plugins: [],
};
