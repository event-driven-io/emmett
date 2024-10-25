import { defineConfig } from 'tsup';

const env = process.env.NODE_ENV;

export default defineConfig([
  {
    splitting: true,
    clean: true,
    dts: true,
    format: ['esm', 'cjs'],
    // TODO: For some reason minified code doesn't work for cjs
    minify: false, //env === 'production',
    bundle: true, //env === 'production',
    skipNodeModulesBundle: true,
    watch: env === 'development',
    target: 'esnext',
    outDir: 'dist', //env === 'production' ? 'dist' : 'lib',
    entry: ['src/index.ts'],
    sourcemap: true,
  },
]);
