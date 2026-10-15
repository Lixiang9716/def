/**
 * stryker.shell-js.conf.mjs — family 1 of the scoped Stryker pilot
 * (doc/test-coverage.md hardening item 5; INFORMATIONAL — score is reported,
 * never gated: thresholds.break stays null and CI never runs Stryker).
 *
 * Scope: the dsh-shell-js refusal vocabulary + exit-code semantics —
 * applets-support.js wholesale (ShellRefusal, unavailableRefusal, the path
 * model, argv flag parsing, the pure word helpers) and, in
 * applets-shelljs.js, ONLY the shellStringOutcome normalization (the
 * mutation range 123:1-133:2; the shelljs mount and the glob route are out
 * of this pilot's scope). The driver is the panel suite's shell-js family
 * (test/panel/shell-js*.test.js) through vitest.shell-js.config.mjs — no
 * test or production bytes are re-pointed; Stryker mutates sandbox copies.
 *
 * Run (from the worktree root, after `test/mutation` setup — see the pilot
 * note in .agents/notes/implemented/testing/):
 *   test/mutation/node_modules/.bin/stryker run test/mutation/stryker.shell-js.conf.mjs
 */
export default {
  testRunner: 'vitest',
  vitest: { configFile: 'test/mutation/vitest.shell-js.config.mjs' },
  coverageAnalysis: 'perTest',
  mutate: [
    'runtime/dsh/system-plugins/dsh-shell-js/applets-support.js',
    'runtime/dsh/system-plugins/dsh-shell-js/applets-shelljs.js:123:1-133:2',
  ],
  reporters: ['clear-text', 'progress', 'json'],
  jsonReporter: { fileName: 'test/mutation/reports/shell-js.json' },
  // Re-create the vendor seam link inside the sandbox (the real
  // runtime/dsh/vendor symlink is ignored below — Stryker's copyFile cannot
  // clone a directory symlink; see prepare-sandbox.mjs).
  buildCommand: 'node test/mutation/prepare-sandbox.mjs',
  // Informational pilot: the score is never a verdict.
  thresholds: { high: 0, low: 0, break: null },
  // Keep the sandbox lean: only this family's import graph is read; the
  // vendored engines (external/) are ignored — the vendor symlink is
  // re-created inside the sandbox by the buildCommand above.
  ignorePatterns: [
    'external',
    'hosts',
    // The iSH guest-root carries absolute symlinks (/bin/busybox) that dangle
    // on the mutation host — the sandbox copy cannot readlink them. Nothing
    // in this family's import graph lives there.
    'runtime/dsh/artifacts',
    // A symlink to external/: Stryker's copyFile chokes on it (ENOTSUP), so
    // it is excluded from the copy and re-created by the buildCommand.
    'runtime/dsh/vendor',
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
  ],
  tempDirName: 'test/mutation/.stryker-tmp',
};
