import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * vitest.publisher-token.config.mjs — family-3 vitest face for the Stryker
 * pilot (test-hardening item 5): the mock v1 publisher-token validator
 * (tools/publisher-token.mjs) against its own counterexample net
 * (tools/publisher-token.test.mjs, unmodified — the falsify-then-restore
 * record stays the operative proof). The validator is imported relatively
 * by the suite, so mutants activate inside the Stryker sandbox.
 */
const root = fileURLToPath(new URL('../..', import.meta.url)); // repo root

export default defineConfig({
  root,
  test: {
    environment: 'node',
    include: ['tools/publisher-token.test.mjs'],
  },
});
