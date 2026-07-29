import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['**/*.spec.ts'],
    exclude: ['**/*.browser.spec.ts', '**/node_modules/**', '**/dist/**'],
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
});

/**
 * For packages where every spec file boots its own Docker container. A dozen
 * databases starting at once are all slower than one, so the default 30s hook
 * deadline expires while they wait on each other rather than on any real
 * defect. Only the deadline is raised: capping workers here instead would give
 * these projects a 'maxWorkers' the others do not share, which Vitest resolves
 * by running them as a separate, sequential group.
 */
export const containersShared = defineConfig({
  test: {
    environment: 'node',
    include: ['**/*.spec.ts'],
    exclude: ['**/*.browser.spec.ts', '**/node_modules/**', '**/dist/**'],
    hookTimeout: 120_000,
    testTimeout: 30_000,
  },
});
