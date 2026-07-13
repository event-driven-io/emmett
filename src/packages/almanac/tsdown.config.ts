import { defineConfig } from 'tsdown';

export default defineConfig({
  dts: true,
  format: ['esm', 'cjs'],
  fixedExtension: false,
  minify: false,
  target: 'esnext',
  outDir: 'dist',
  entry: [
    'src/index.ts',
    'src/otel.ts',
    'src/otel-node.ts',
    'src/pino.ts',
    'src/console.ts',
  ],
  sourcemap: true,
  deps: {
    skipNodeModulesBundle: true,
  },
  tsconfig: 'tsconfig.build.json',
});
