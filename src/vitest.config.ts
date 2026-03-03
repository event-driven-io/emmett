import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      'packages/emmett',
      'packages/emmett-expressjs',
      'packages/emmett-postgresql',
      'packages/emmett-mongodb',
      'packages/emmett-esdb',
      'packages/emmett-fastify',
      'packages/emmett-tests',
      'packages/emmett-sqlite',
    ],
  },
});
