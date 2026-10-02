import { defineConfig } from 'vitest/config';
import { containersShared } from '../../vitest.shared.ts';

export default defineConfig({
  ...containersShared,
  test: {
    ...containersShared.test,
    name: '@event-driven-io/emmett-postgresql (unit)',
    exclude: [
      ...(containersShared.test?.exclude ?? []),
      '**/*.int.spec.ts',
      '**/*.e2e.spec.ts',
    ],
  },
});
