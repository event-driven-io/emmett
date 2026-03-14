import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      'packages/emmett',
      'packages/emmett-expressjs',
      'packages/emmett-honojs',
      'packages/emmett-postgresql',
      'packages/emmett-mongodb',
      'packages/emmett-esdb',
      'packages/emmett-opossum',
      'packages/emmett-fastify',
      'packages/emmett-tests',
      'packages/emmett-sqlite',
    ],
  },
});
