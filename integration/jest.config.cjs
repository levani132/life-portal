/**
 * Integration tests (issue #22): the real API against a real MongoDB. Not part of `npm run
 * check`, which must stay fast and need no database. Run with `npm run test:integration`; see
 * `docs/runbooks/offline-sync.md`.
 */
module.exports = {
  displayName: 'integration',
  rootDir: '..',
  roots: ['<rootDir>/integration'],
  testMatch: ['<rootDir>/integration/**/*.integration.ts'],
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]sx?$': ['ts-jest', { tsconfig: '<rootDir>/integration/tsconfig.json' }],
  },
  moduleNameMapper: {
    '^@life-portal/shared-types$': '<rootDir>/libs/shared/types/src/index.ts',
    '^@life-portal/shared-domain$': '<rootDir>/libs/shared/domain/src/index.ts',
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'json'],
  testTimeout: 60_000,
};
