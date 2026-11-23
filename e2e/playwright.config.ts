import { defineConfig } from '@playwright/test';

/**
 * Screen tests: the built web app and API against a throwaway Mongo, at a phone's size. They
 * check that the key flows still work and save a phone screenshot of each for review.
 *
 * Run: build first (`npm run build` with NEXT_PUBLIC_API_URL=http://localhost:3333/api), start a
 * throwaway Mongo, then `E2E_MONGODB_URI=mongodb://127.0.0.1:27021 npm run test:e2e`. The
 * database is `lp-e2e` and is dropped before every run: never point this at real data.
 */
const mongo = (process.env['E2E_MONGODB_URI'] ?? '').replace(/\/+$/, '');
if (!mongo) throw new Error('E2E_MONGODB_URI is not set (a throwaway Mongo; the lp-e2e database is dropped).');

export default defineConfig({
  testDir: './tests',
  outputDir: './results',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env['CI'] ? 1 : 0,
  reporter: [['list'], ['html', { outputFolder: './report', open: 'never' }]],
  globalSetup: './global-setup.ts',
  use: {
    baseURL: 'http://localhost:4200',
    // A phone: what people use the app on.
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    trace: 'off',
    screenshot: 'only-on-failure',
    ...(process.env['PW_CHROMIUM_PATH'] ? { launchOptions: { executablePath: process.env['PW_CHROMIUM_PATH'] } } : {}),
  },
  webServer: [
    {
      command: 'node dist/apps/api/main.js',
      cwd: '..',
      port: 3333,
      reuseExistingServer: !process.env['CI'],
      timeout: 60_000,
      env: {
        MONGODB_URI: `${mongo}/lp-e2e`,
        JWT_SECRET: 'e2e-only-secret-e2e-only-secret-e2e-only-secret',
        API_PORT: '3333',
        CORS_ORIGINS: 'http://localhost:4200,http://127.0.0.1:4200',
        TRUST_PROXY_HOPS: '1',
        DISABLE_SCHEDULES: 'true',
        NODE_NO_WARNINGS: '1',
        MAIL_PROVIDER: 'dev',
        WEB_BASE_URL: 'http://localhost:4200',
      },
    },
    {
      command: 'npx next start --port 4200',
      cwd: '../apps/web',
      port: 4200,
      reuseExistingServer: !process.env['CI'],
      timeout: 120_000,
    },
  ],
});
