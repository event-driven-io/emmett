import { defineConfig } from 'vitest/config';
import { containersShared } from '../../vitest.shared';

export default defineConfig({
  ...containersShared,
  test: {
    ...containersShared.test,
    globalSetup: ['./src/testing/sharedMongoDBGlobalSetup.ts'],
  },
});
