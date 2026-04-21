import { defineConfig } from 'tsdown';

export default defineConfig({
  dts: true,
  format: ['esm', 'cjs'],
  fixedExtension: false,
  minify: false,
  target: 'esnext',
  outDir: 'dist',
  entry: ['src/index.ts'],
  sourcemap: true,
  deps: {
    skipNodeModulesBundle: true,
    neverBundle: [
      '@types/pg',
      'pg',
      '@event-driven-io/emmett',
      '@event-driven-io/pongo',
    ],
  },
  tsconfig: 'tsconfig.build.json',
});
