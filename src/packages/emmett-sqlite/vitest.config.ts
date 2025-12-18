import { defineConfig } from 'vitest/config';
import shared from '../../vitest.shared';

export default defineConfig({
  ...shared,
  // test: {
  //   ...shared.test,
  //   projects: [
  //     {
  //       extends: true,
  //       test: {
  //         name: 'node',
  //       },
  //     },
  //     {
  //       extends: true,
  //       test: {
  //         name: 'browser',
  //         include: ['**/*.browser.spec.ts'],
  //         exclude: [],
  //         browser: {
  //           provider: 'playwright',
  //           headless: true,
  //           enabled: true,
  //           instances: [{ browser: 'chromium' }],
  //         },
  //       },
  //     },
  //   ],
  // },
});
