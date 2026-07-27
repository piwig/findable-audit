import { defineConfig } from 'vitest/config';

// globalSetup compiles dist/ once, before any worker starts. It must NOT be a
// per-suite beforeAll: several suites spawn dist/index.js while other files run
// in parallel, and rewriting dist mid-run is what made CI flaky (see
// test/global-setup.ts for the full story).
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 15000,
    globalSetup: ['./test/global-setup.ts'],
  },
});
