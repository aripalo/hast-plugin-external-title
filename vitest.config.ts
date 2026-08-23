import { defaultExclude, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Integration tests live in their own config and script — see
    // vitest.integration.config.ts. Spreading `defaultExclude` matters: a bare
    // `exclude` replaces the defaults rather than adding to them, which would
    // start globbing node_modules.
    exclude: [...defaultExclude, 'test/integration/**'],
    coverage: {
      provider: 'v8',
      // Measure every source file, not just the ones a test happened to
      // import, so a new uncovered module cannot slip in unnoticed.
      include: ['src/**/*.ts'],
      reporter: ['text', 'html'],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});
