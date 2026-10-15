import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * vitest.shell-js.config.mjs — family-1 vitest face for the Stryker pilot
 * (test-hardening item 5): the dsh-shell-js refusal-vocabulary family —
 * applets-support.js + applets-shelljs.js's shellStringOutcome — driven by
 * the EXISTING panel suites (test/panel/shell-js*.test.js, unmodified).
 *
 * The alias rows are the subset of test/panel/vitest.config.js that this
 * family's import graph actually resolves (the bare specifiers the plugin
 * and the two suites use); paths are computed from this file's location so
 * the sandbox Stryker builds resolves the same bytes. The mutated files
 * themselves resolve RELATIVELY from the suites, so mutants activate inside
 * the Stryker sandbox — nothing here may alias them by absolute path.
 */
const here = fileURLToPath(new URL('.', import.meta.url)); // test/mutation/
const root = fileURLToPath(new URL('../..', import.meta.url)); // repo root

export default defineConfig({
  root,
  test: {
    environment: 'node',
    include: [
      'test/panel/shell-js.test.js',
      'test/panel/shell-js-applets.test.js',
      'test/panel/shell-js-support.test.js',
    ],
  },
  resolve: {
    alias: [
      { find: 'logger.js', replacement: `${here}../panel/logger-shim.js` },
      { find: 'gateway.js', replacement: `${here}../panel/gateway-shim.js` },
      { find: '@deepseek-ai/dsh-tools', replacement: `${here}../panel/dsh-tools-stub.js` },
      { find: 'sha256.js', replacement: `${root}runtime/dsh/sha256.js` },
      { find: 'tar-mini.js', replacement: `${root}runtime/dsh/tar-mini.js` },
      // The vendor seam's on-device spelling ('/vendor/npm/…'), for parity
      // with the panel config; under Node the runtime/dsh/vendor symlink
      // serves parser.js directly, so this row is belt-and-braces.
      {
        find: /^\/vendor\//,
        replacement: fileURLToPath(new URL('../../external/', import.meta.url)),
      },
    ],
  },
});
