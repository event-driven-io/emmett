import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    workspace: ['packages/emmett-sqlite/vitest.config.ts'],
  },
});
