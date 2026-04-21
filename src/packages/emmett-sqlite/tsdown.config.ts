import { defineConfig } from 'tsdown';

export default defineConfig({
  dts: true,
  format: ['esm', 'cjs'],
  fixedExtension: false,
  minify: false,
  target: 'esnext',
  outDir: 'dist',
  entry: ['src/index.ts', 'src/cli.ts', 'src/cloudflare.ts', 'src/sqlite3.ts'],
  sourcemap: true,
  deps: {
    skipNodeModulesBundle: true,
    neverBundle: [
      'sqlite3',
      '@cloudflare/workers-types',
      '@event-driven-io/emmett',
      '@event-driven-io/pongo',
    ],
  },
  tsconfig: 'tsconfig.build.json',
});
