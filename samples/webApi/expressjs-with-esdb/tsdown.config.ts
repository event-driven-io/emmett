import { defineConfig } from 'tsdown';

export default defineConfig({
  dts: true,
  format: ['esm'],
  fixedExtension: false,
  minify: true,
  target: 'esnext',
  outDir: 'dist',
  entry: ['src/index.ts'],
  sourcemap: true,
  deps: {
    skipNodeModulesBundle: true,
  },
});
