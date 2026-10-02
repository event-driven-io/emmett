import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    maxWorkers: '50%',
    projects: [
      'packages/almanac',
      'packages/emmett',
      'packages/emmett-expressjs',
      'packages/emmett-honojs',
      'packages/emmett-postgresql/vitest.config.ts',
      'packages/emmett-postgresql/vitest.integration.config.ts',
      'packages/emmett-mongodb/vitest.config.ts',
      'packages/emmett-mongodb/vitest.integration.config.ts',
      'packages/emmett-esdb/vitest.config.ts',
      'packages/emmett-esdb/vitest.integration.config.ts',
      'packages/emmett-testcontainers',
      'packages/emmett-fastify',
      'packages/emmett-tests/vitest.config.ts',
      'packages/emmett-tests/vitest.integration.config.ts',
      'packages/emmett-sqlite',
      'vitest.cloudflare.config.ts',
      {
        test: {
          name: 'bundle',
          environment: 'node',
          include: ['e2e/bundleBoundaries.bundle.spec.ts'],
          globalSetup: ['e2e/buildBundles.ts'],
        },
      },
      {
        test: {
          name: 'agents',
          environment: 'node',
          include: ['../.agents/**/*.spec.ts', '../.opencode/**/*.spec.ts'],
        },
      },
    ],
  },
});
