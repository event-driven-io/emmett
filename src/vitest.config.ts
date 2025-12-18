import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['./packages/emmett-sqlite/**/*.spec.ts'],
          exclude: ['./packages/emmett-sqlite/**/*.browser.spec.ts'],
        },
      },
      {
        test: {
          name: 'browser',
          browser: {
            provider: 'playwright',
            enabled: true,
            instances: [{ browser: 'chromium' }],
          },
          include: ['./packages/emmett-sqlite/**/*.browser.spec.ts'],
        },
      },
    ],
  },
});
