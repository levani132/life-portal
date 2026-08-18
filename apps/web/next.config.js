//@ts-check

const path = require('path');

/**
 * Plain Next config, deliberately not wrapped in `@nx/next`'s `withNx`.
 *
 * Next 16 builds with Turbopack, which bundles the config file's transitive requires.
 * `withNx` pulls in `nx/src/adapter/ngcli-adapter`, which requires `@angular-devkit/architect`
 * — a package this workspace has no reason to install — so the build fails with ten
 * module-not-found errors. Nothing here needs `withNx`: workspace libraries resolve through
 * the `tsconfig.base.json` path aliases, which Next reads natively.
 *
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  // The monorepo root, so file tracing follows imports out of `apps/web` into `libs/`.
  outputFileTracingRoot: path.join(__dirname, '../../'),
};

module.exports = nextConfig;
