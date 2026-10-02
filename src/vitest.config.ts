import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    ...(process.env.CI ? {} : { maxWorkers: '50%' }),
    projects: [
      'packages/almanac',
      'packages/emmett',
      'packages/emmett-expressjs',
      'packages/emmett-honojs',
      'packages/emmett-postgresql/vitest.unit.config.ts',
      'packages/emmett-postgresql/vitest.postgresql.config.ts',
      'packages/emmett-mongodb/vitest.unit.config.ts',
      'packages/emmett-mongodb/vitest.mongodb.config.ts',
      'packages/emmett-esdb/vitest.unit.config.ts',
      'packages/emmett-esdb/vitest.eventstoredb.config.ts',
      'packages/emmett-testcontainers',
      'packages/emmett-fastify',
      'packages/emmett-tests/vitest.unit.config.ts',
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
