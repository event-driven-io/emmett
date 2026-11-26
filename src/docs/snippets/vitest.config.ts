import { defineConfig } from 'vitest/config';
import { containersShared } from '../../vitest.shared.ts';

export default defineConfig({
  ...containersShared,
  test: {
    ...containersShared.test,
    name: 'docs (snippets)',
  },
});
