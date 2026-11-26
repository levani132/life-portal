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
  async rewrites() {
    return [
      // Spec 046: a portal's address, `/@username`, is served by `/u/[username]`.
      { source: '/@:username', destination: '/u/:username' },
      // Serve the local browser and API from one development origin.
      ...(process.env.NODE_ENV === 'development'
        ? [
            {
              source: '/api/:path*',
              // API_DEV_TARGET: another API port, when 3333 is taken by a second checkout.
              destination: `${process.env.API_DEV_TARGET ?? 'http://127.0.0.1:3333/api'}/:path*`,
            },
          ]
        : []),
    ];
  },
  // The monorepo root, so file tracing follows imports out of `apps/web` into `libs/`.
  outputFileTracingRoot: path.join(__dirname, '../../'),
};

module.exports = nextConfig;
