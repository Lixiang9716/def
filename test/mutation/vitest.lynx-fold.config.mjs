import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * vitest.lynx-fold.config.mjs — family-2 vitest face for the Stryker pilot
 * (test-hardening item 5): the lynx-client pure state-machine family —
 * shared/fold.js + shared/surface-core.js — driven by the EXISTING vitest
 * suites (tests/fold.test.js + tests/seam.test.js, unmodified). No aliases:
 * the suites import the shared modules relatively, so the mutants activate
 * inside the Stryker sandbox.
 */
const root = fileURLToPath(new URL('../..', import.meta.url)); // repo root

export default defineConfig({
  root,
  test: {
    environment: 'node',
    include: [
      'presentation/lynx-client/tests/fold.test.js',
      'presentation/lynx-client/tests/seam.test.js',
    ],
  },
});
