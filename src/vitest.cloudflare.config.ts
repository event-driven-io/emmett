import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';
import { localMaxWorkers } from './vitest.shared.ts';

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: {
        configPath: './packages/emmett-sqlite/wrangler.durable-object.jsonc',
      },
    }),
  ],
  test: {
    name: '@event-driven-io/cloudflare',
    include: [
      'packages/emmett-sqlite/src/storage/durableObject/**/*.int.spec.ts',
      'packages/emmett-sqlite/src/storage/durableObject/**/*.e2e.spec.ts',
    ],
    hookTimeout: 120_000,
    testTimeout: 30_000,
    ...localMaxWorkers,
  },
});
