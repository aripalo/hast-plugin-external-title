import { defineConfig } from 'vitest/config';

/**
 * Integration tests, kept out of the default run.
 *
 * These boot a real Astro build, which pulls in a large dependency tree and
 * takes seconds rather than milliseconds. Running them here rather than in
 * `vitest.config.ts` keeps `pnpm test` fast, keeps the Node matrix from paying
 * the cost three times, and — because `prepublishOnly` runs `test:coverage` —
 * keeps an Astro or Rolldown hiccup out of the release path.
 */
export default defineConfig({
  test: {
    include: ['test/integration/**/*.test.ts'],
    // A cold Astro build far exceeds vitest's 5s default. The suite-level
    // hook has its own timeout too; this covers the individual cases.
    testTimeout: 120_000,
    hookTimeout: 120_000,
    // One build shared by every assertion in the file, so no parallelism.
    fileParallelism: false,
    // v8 coverage would instrument an entire Astro/Rolldown build for nothing:
    // `pnpm test:coverage` already holds src/ at 100%.
    coverage: { enabled: false },
  },
});
