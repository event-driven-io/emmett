import { defineConfig } from 'vitest/config';

export const localMaxWorkers = process.env.CI ? {} : { maxWorkers: '50%' };

export default defineConfig({
  test: {
    environment: 'node',
    include: ['**/*.spec.ts'],
    exclude: [
      '**/*.browser.spec.ts',
      '**/src/storage/durableObject/**/*.int.spec.ts',
      '**/src/storage/durableObject/**/*.e2e.spec.ts',
      '**/node_modules/**',
      '**/dist/**',
      '**/lib/**',
    ],
    hookTimeout: 30_000,
    testTimeout: 30_000,
    ...localMaxWorkers,
  },
});

/** Shared limits for projects whose hooks start Testcontainers. */
export const containersShared = defineConfig({
  test: {
    environment: 'node',
    include: ['**/*.spec.ts'],
    exclude: [
      '**/*.browser.spec.ts',
      '**/src/storage/durableObject/**/*.int.spec.ts',
      '**/src/storage/durableObject/**/*.e2e.spec.ts',
      '**/node_modules/**',
      '**/dist/**',
      '**/lib/**',
    ],
    hookTimeout: 60_000,
    testTimeout: 30_000,
    ...localMaxWorkers,
  },
});
