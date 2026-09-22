import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      'packages/almanac',
      'packages/emmett',
      'packages/emmett-expressjs',
      'packages/emmett-honojs',
      'packages/emmett-postgresql',
      'packages/emmett-mongodb',
      'packages/emmett-esdb',
      'packages/emmett-testcontainers',
      'packages/emmett-fastify',
      'packages/emmett-tests',
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
