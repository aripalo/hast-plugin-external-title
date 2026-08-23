import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
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
