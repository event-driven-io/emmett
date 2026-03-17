import { defineConfig } from 'tsup';

const env = process.env.NODE_ENV;

export default defineConfig([
  {
    format: ['esm', 'cjs'],
    splitting: true,
    clean: true,
    dts: true,
    minify: false,
    bundle: true,
    skipNodeModulesBundle: true,
    watch: env === 'development',
    target: 'esnext',
    outDir: 'dist',
    entry: ['src/index.ts', 'src/otel.ts', 'src/pino.ts'],
    sourcemap: true,
    tsconfig: 'tsconfig.build.json',
  },
]);
