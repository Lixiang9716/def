/**
 * stryker.lynx-fold.conf.mjs — family 2 of the scoped Stryker pilot
 * (doc/test-coverage.md hardening item 5; INFORMATIONAL — score is reported,
 * never gated: thresholds.break stays null and CI never runs Stryker).
 *
 * Scope: the lynx-client pure state machine — shared/fold.js (the
 * view-event fold) + shared/surface-core.js (the seam core) — driven by the
 * existing vitest suites tests/fold.test.js + tests/seam.test.js through
 * vitest.lynx-fold.config.mjs. No production or test bytes are re-pointed.
 *
 * Run (from the worktree root):
 *   test/mutation/node_modules/.bin/stryker run test/mutation/stryker.lynx-fold.conf.mjs
 */
export default {
  testRunner: 'vitest',
  vitest: { configFile: 'test/mutation/vitest.lynx-fold.config.mjs' },
  coverageAnalysis: 'perTest',
  mutate: [
    'presentation/lynx-client/shared/fold.js',
    'presentation/lynx-client/shared/surface-core.js',
  ],
  reporters: ['clear-text', 'progress', 'json'],
  jsonReporter: { fileName: 'test/mutation/reports/lynx-fold.json' },
  // Informational pilot: the score is never a verdict.
  thresholds: { high: 0, low: 0, break: null },
  ignorePatterns: [
    'external',
    'hosts',
    // This family never enters runtime/ — and the tree's runtime/dsh/vendor
    // symlink cannot survive Stryker's copyFile (see prepare-sandbox.mjs).
    'runtime',
    'packages',
    'third-party',
    'baselines',
    'graphify-out',
    'deploy',
    'example',
    'doc',
    'src',
    'build',
    'cmake',
    'tmp',
    'coverage',
    '.gov',
    '.agents',
    '.zcode',
    // lynx-client's own node_modules (gitignored, provisioned for the
    // package's own runs) — the pilot resolves vitest from test/mutation.
    'presentation/lynx-client/node_modules',
    'presentation/lynx-client/bundle',
    'presentation/lynx-client/artifacts',
    'presentation/lynx-client/coverage',
  ],
  tempDirName: 'test/mutation/.stryker-tmp',
};
