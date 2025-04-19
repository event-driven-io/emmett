import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    workspace: [
      {
        test: {
          name: 'node',
          environment: 'node', // Runs tests in Node.js
          include: ['./packages/emmett-sqlite/**/*.spec.ts'],
          exclude: ['./packages/emmett-sqlite/**/*.browser.spec.ts'],
        },
      },
      {
        test: {
          name: 'browser tests',
          browser: {
            provider: 'playwright', // or 'webdriverio'
            enabled: true,
            // at least one instance is required
            instances: [{ browser: 'chromium' }],
          },
          include: ['./packages/emmett-sqlite/**/*.browser.spec.ts'],
        },
      },
    ],
  },
});
