import { defineConfig } from 'vitest/config';
import panel from '../vitest.config.js';

// Property suites (test-hardening row 7) drive the same runtime modules as
// the panel suite, so they reuse the panel config's proven bare-specifier
// alias table verbatim ('logger.js', 'install-pipeline.js', the node:path
// posix pin, the upstream/shims family map). The panel gate's own run never
// collects this directory — its include is the top-level '*.test.js' — this
// config roots the fastcheck runner HERE (run.sh cds into this directory).
// The suite needs no globalSetup: none of the three parsers touches the
// vendored packages provision-vendor.mjs stages.
export default defineConfig({
  test: {
    include: ['*.test.js', '*.test.mjs'],
    environment: 'node',
  },
  resolve: { alias: panel.resolve.alias },
});
