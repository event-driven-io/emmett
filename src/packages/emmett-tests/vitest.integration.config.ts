import { defineConfig } from 'vitest/config';
import { containersShared } from '../../vitest.shared.ts';

export default defineConfig({
  ...containersShared,
  test: {
    ...containersShared.test,
    name: '@event-driven-io/emmett-tests (integration)',
    include: ['**/*.int.spec.ts', '**/*.e2e.spec.ts'],
    globalSetup: ['./src/testing/sharedPostgreSQLGlobalSetup.ts'],
  },
});
