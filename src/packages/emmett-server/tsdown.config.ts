import { defineConfig } from 'tsdown';

export default defineConfig({
  dts: true,
  format: ['esm', 'cjs'],
  fixedExtension: false,
  minify: false,
  target: 'esnext',
  outDir: 'dist',
  entry: {
    index: 'src/index.ts',
    contract: 'src/contract/index.ts',
    testing: 'src/testing/index.ts',
  },
  sourcemap: true,
  deps: {
    skipNodeModulesBundle: true,
  },
  tsconfig: 'tsconfig.build.json',
});
