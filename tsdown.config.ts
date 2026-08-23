import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'cache/index': 'src/cache/index.ts',
  },
  outDir: 'dist',
  format: 'esm',
  platform: 'node',
  target: 'node22.11',
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  fixedExtension: false,
});
