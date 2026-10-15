/**
 * stryker.publisher-token.conf.mjs — family 3 of the scoped Stryker pilot
 * (doc/test-coverage.md hardening item 5; INFORMATIONAL — score is reported,
 * never gated: thresholds.break stays null and CI never runs Stryker).
 *
 * Scope: the mock v1 publisher-token validator (tools/publisher-token.mjs)
 * against its own counterexample net (tools/publisher-token.test.mjs, the
 * falsify-then-restore record). No production or test bytes are re-pointed.
 *
 * Run (from the worktree root):
 *   test/mutation/node_modules/.bin/stryker run test/mutation/stryker.publisher-token.conf.mjs
 */
export default {
  testRunner: 'vitest',
  vitest: { configFile: 'test/mutation/vitest.publisher-token.config.mjs' },
  coverageAnalysis: 'perTest',
  mutate: ['tools/publisher-token.mjs'],
  reporters: ['clear-text', 'progress', 'json'],
  jsonReporter: { fileName: 'test/mutation/reports/publisher-token.json' },
  // Informational pilot: the score is never a verdict.
  thresholds: { high: 0, low: 0, break: null },
  ignorePatterns: [
    'external',
    'hosts',
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
    'presentation',
    'runtime',
    // NOTE: test/ stays in the copy — the sandboxed vitest reads
    // test/mutation/vitest.publisher-token.config.mjs from inside the
    // sandbox, so the config tree must survive the ignore list.
  ],
  tempDirName: 'test/mutation/.stryker-tmp',
};
