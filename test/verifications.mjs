// dsh:logging-exempt (diagnostic: its stdout is the answer)
/**
 * verifications.mjs — the verification registry and its query CLI.
 *
 * One table registers every verification leg: which leg the counts answer
 * on (countsFrom), what the leg needs, where it can run, and where the
 * evidence lives. The registry holds only CONFIRMED facts — every runner,
 * status and reason below is backed by a named file on this tree today.
 * The unified test driver that re-runs these legs grows here, in this
 * file, as it lands.
 *
 * The registry is exported (REGISTRY) so drivers can consume the machine
 * fields without scraping this CLI's prose: the `upstream-sweep` entry
 * carries a `drive` block (specs dir, output paths, per-leg spawn recipes)
 * that tools/test/sweep.mjs executes. The prose fields below stay the
 * human contract; `drive` is the executable one.
 *
 * usage:
 *   node test/verifications.mjs --list
 *       one line per registered entry.
 *   node test/verifications.mjs --why <registry-name | artifact-stem>
 *       which leg the counts come from, which legs are dead and why, and
 *       where the evidence lives. Accepts a registry name or an artifact
 *       stem (e.g. core__agent-loop__tests__loop.spec.mjs).
 *   node test/verifications.mjs --resolve <tests-tree-relative-path>
 *       the flattened artifact name for a spec path. Only entries carrying
 *       a resolve function answer; a path none of them claims lists the
 *       entries that do.
 *   node test/verifications.mjs --check-fresh
 *       compare the staged upstream-tests' generation stamp against the
 *       current inputs (transpilers, pin stamps, esbuild). Nonzero = stale:
 *       re-run node test/upstream-suite/transpile.mjs first.
 *
 * The CLI face runs only when this file is the entry module; importing
 * verifications.mjs has zero side effects.
 *
 * Unknown names fail loud naming the offender (rule 5): exit 1.
 */

import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeFingerprint } from './upstream-suite/generation.mjs';

export { computeFingerprint };

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const GENERATION_STAMP = join(ROOT, 'runtime/dsh/upstream-tests/.generation');
const TRANSPILER = 'node test/upstream-suite/transpile.mjs';

const FLATTEN_SOURCE = 'test/upstream-suite/transpile.mjs (line ~225)';
const flattenSpecPath = (rel) =>
  rel.split('/').join('__').replace(/\.spec\.ts$/, '.spec.mjs');

/** The qjs leg's spawn recipe, verbatim from the bash sweep: inside
 * runtime/dsh, run `./build/dsh-cli . scenario/upstream-suite-leg.js
 * --env DSH_UPSTREAM_SPEC=upstream-tests/<name>`. A module-level arrow —
 * inlining the array in the REGISTRY pushed its items past the code-size
 * gate's indent budget. */
const qjsLegArgv = (name) => [
  './build/dsh-cli',
  '.',
  'scenario/upstream-suite-leg.js',
  '--env',
  'DSH_UPSTREAM_SPEC=upstream-tests/' + name,
];

export const REGISTRY = [
  {
    name: 'upstream-sweep',
    what: 'the FULL upstream dsh-tests suite sweep, both legs',
    countsFrom:
      'the qjs leg — tools/test/sweep.mjs (the Node sweep driver; runtime/dsh/ci/' +
      'run-upstream-suite-sweep.sh is an exec shim into it) running every transpiled ' +
      'spec through scenario upstream.suite (runtime/dsh/scenario/upstream-suite-leg.js)',
    legs: [
      {
        id: 'qjs',
        status: 'live',
        runner:
          'tools/test/sweep.mjs qjs leg -> runtime/dsh/scenario/upstream-suite-leg.js ' +
          '(runtime/dsh/ci/run-upstream-suite-sweep.sh exec-shims into the driver)',
        column: 'qjs',
        drive: {
          cwd: 'runtime/dsh',
          requires: 'runtime/dsh/build/dsh-cli',
          argv: qjsLegArgv,
          summary: { pattern: '"event":"suite/summary".*', pick: 'last' },
          retries: 1,
        },
      },
      {
        id: 'node-differential',
        status: 'divergent',
        runner:
          'tools/test/sweep.mjs node leg (test/upstream-suite/smoke.mjs)',
        reason:
          'runs since the dsh-subprocess-local/index subpath row landed in ' +
          'smoke-hooks (2026-10-20). The 2026-10-21 full-tree differential ' +
          '(681 specs) classified all 101 disagreement rows ' +
          '(testing/2026-10-21 note): 58 harness artifacts — the #626 ' +
          'node:child_process shim masking plus the missing node-side ' +
          'fixture seeding, the rows the NODE_BUILTIN_PASSTHROUGH fix is ' +
          'expected to flip; 15 Node-face gaps (no fixture seeding, no ' +
          'web-storage globals, no fetch-loopback seam, no tsx host ' +
          'intrinsics in smoke.mjs); 24 real runtime deltas — the ' +
          "differential's actual value; 4 Node-only abilities the qjs host " +
          'answers unavailable by design (the persistence worker). The ' +
          '#626 passthrough (2026-10-21) re-measured 101 -> 83, and Tier 2 ' +
          '(all eleven node:* rows passthrough, plan 3.3) re-measured ' +
          '83 -> 63. The final classification (testing/2026-10-21 Tier-2 ' +
          'note): a 18 qjs/node staging asymmetries, b 18 node-leg ' +
          'capability gaps (storage globals, fixture seeding, FormData ' +
          'two-face, presets roster, node-pty, tsx intrinsics, loader ' +
          'internals, resolve semantics), c 17 real behavior deltas, d 10 ' +
          'spec-requires-host-unavailable rows (persistence worker, ssh ' +
          'TLS, platform-gated bash). The node-leg seams (2026-10-21, ' +
          'testing note) then landed 6 of the b rows: 63 -> 58, b 18 -> 12 ' +
          '(the remaining 12 need per-family fixture seeding, loader ' +
          'internals wiring, a node-pty vendor row, and the resolve ' +
          'semantics fix). Divergence is the leg finding its differential ' +
          'value; treat qjs as the only counting leg. The fixture seeding ' +
          '(2026-10-21, per-process work roots — isolation over leakage) ' +
          'then landed 24 more rows: 63 -> 58 -> 46, and five ' +
          'leakage-blessed rows flipped to NO under the correct isolation ' +
          'inspector host ×2) — fresh triage rows. The node harness now ' +
          'executes the shim tables + bridges family (2026-10-21): mount ' +
          '14/39 -> 51/2, inventory all-fail -> 9/3 inside their rows. The ' +
          'b-closeout (2026-10-22) then vendored the node-pty pair ' +
          '(controller flips: node 55/0), moved the typert resolve face to ' +
          'the staged-fs read, and re-measured: 63 -> 42, with the same ' +
          'five leakage-blessed rows NO under the correct isolation. The ' +
          'diff-closeout (2026-10-22, the terminal state) then landed the ' +
          'final waves — the loader bridge row, the node-pty provisioning ' +
          'compile, the transpile-inline sibling staging, the ENUMERATED ' +
          'farm re-anchor (compaction/goal instanceof rows; the blanket ' +
          'form hijacked tool-web), the dual-realm FormData gate, the ' +
          'no-real-package bridge rows, sparse fs truncate, exports-map ' +
          'resolve, the vitest-faithful stubEnv, the existsSync VFS-miss ' +
          'real-disk fall-through, the child stdio close — 30 rows ' +
          'flipped to agreement, and the remaining 15 moved into the ' +
          'committed differential ledger ' +
          '(test/upstream-suite/differential-ledger.json, read by the ' +
          'sweep driver: 9 d-contract, 5 c-delta, 1 both-red; the totals ' +
          'report documented vs unexplained and name every unexplained ' +
          'or stale row — terminal state: 15 disagreements, 15 ' +
          'documented, 0 unexplained). This entry is done: the ' +
          'differential is honest end to end and every disagreement ' +
          'names its finding.',
        column: 'node',
        drive: {
          cwd: '.',
          argv: (name) => ['node', 'test/upstream-suite/smoke.mjs', name],
          summary: { pattern: 'harness smoke: \\{.*\\}', pick: 'first' },
          retries: 0,
        },
      },
    ],
    transpiler: 'test/upstream-suite/transpile.mjs',
    flatten:
      "spec path '/' -> '__' and .spec.ts -> .spec.mjs into runtime/dsh/upstream-tests/ " +
      `(${FLATTEN_SOURCE})`,
    evidence: ['doc/e2e-matrix.md'],
    resolve: (testsTreeRelativePath) => {
      const clean = String(testsTreeRelativePath).replace(/^\.\//, '');
      return /\.spec\.ts$/.test(clean) ? flattenSpecPath(clean) : null;
    },
    drive: {
      specsDir: 'runtime/dsh/upstream-tests',
      specSuffix: '.spec.mjs',
      out: {
        report: 'tmp/upstream-suite-report.tsv',
        totals: 'tmp/upstream-suite-report-totals.txt',
        logDir: 'tmp/upstream-suite-logs',
      },
      legTimeoutMs: 90000,
      defaultParallel: 4,
      freshness: {
        stamp: 'runtime/dsh/upstream-tests/.generation',
        refresh: [
          { cwd: '.', argv: ['sh', 'external/ensure-dsh-tests.sh'] },
          { cwd: 'test/upstream-suite', argv: ['npm', 'install', '--no-audit', '--no-fund'] },
          { cwd: 'test/upstream-suite', argv: ['node', 'transpile.mjs'] },
        ],
      },
    },
  },
  {
    name: 'ios-boot-carrier',
    what: 'iOS boot.verification + carrier.loopback in one simulator launch',
    countsFrom:
      'the single-attempt runner — test/e2e/run-ios-boot-carrier.sh (called ' +
      'run-ios-m1.sh before 2026-10-20)',
    legs: [
      {
        id: 'boot-carrier',
        status: 'live',
        runner: 'test/e2e/run-ios-boot-carrier.sh (one retry, only on an environment red, exit 3)',
      },
    ],
    verdict:
      'test/e2e/check.mjs (the pure scenario checker: logs are the verdict) + ' +
      'test/e2e/classify.mjs (green | product red | environment red)',
    platform: 'darwin',
    ci: '.github/workflows/dev-ios.yml',
    evidence: ['.github/workflows/dev-ios.yml', 'doc/e2e-matrix.md'],
  },
  {
    name: 'panel',
    what: 'the panel vitest suite (the Node-testable appshell/presentation faces)',
    countsFrom: 'vitest — "npm test" in test/panel ("test": "vitest run")',
    legs: [{ id: 'vitest', status: 'live', runner: 'npm test in test/panel (vitest run)' }],
    platform: 'all',
    evidence: ['test/panel/package.json'],
  },
  {
    name: 'harmony-host-e2e',
    what: 'the HarmonyOS host E2E harness ladder (8 scenarios + verdict receipts)',
    countsFrom: 'the host E2E runner — hosts/harmony/ci/run-host-e2e.sh',
    legs: [{ id: 'harness', status: 'live', runner: 'hosts/harmony/ci/run-host-e2e.sh' }],
    platform: 'a live harmony hdc target; Windows drives hdc.exe through WSL interop',
    evidence: ['doc/windows-test-plan.md', 'doc/e2e-matrix.md'],
  },
  {
    name: 'mcp-streamable-http',
    what:
      'the vendored MCP client over the streamable-HTTP transport on gateway httpFetch ' +
      '(scenario mcp.streamable-http against a Node mock MCP server on loopback)',
    countsFrom:
      'the CLI proof leg — runtime/dsh/ci/run-mcp-streamable-http-e2e.sh; the count is the ' +
      'leg\'s scenario events (12 mcp/ records among the 16 total scenario rows) in ' +
      'runtime/dsh/artifacts/macos-cli-mcp-streamable-http/scenario.jsonl, matched ' +
      'one-to-one against the scenario manifest (verdict.json expected↔logged)',
    legs: [
      {
        id: 'cli',
        status: 'live',
        runner:
          'runtime/dsh/ci/run-mcp-streamable-http-e2e.sh (the desktop CLI over the REAL ' +
          'gateway httpFetch; also run by build/build.sh test core)',
      },
    ],
    platform:
      'the desktop CLI host (committed artifacts from darwin; c-core CI runs the leg on ' +
      'ubuntu-24.04-arm through build/build.sh test core)',
    ci: '.github/workflows/c-core.yml',
    evidence: ['runtime/dsh/artifacts/macos-cli-mcp-streamable-http/', 'doc/dsh-desktop-plugins.md'],
  },
];

const failLoud = (message) => {
  console.error(`verifications.mjs: ${message}`);
  process.exit(1);
};

const NAMES = REGISTRY.map((e) => e.name);

/** An artifact stem belongs to upstream-sweep when it carries the flatten
 *  shape: '__'-joined segments, .spec.mjs suffix (see FLATTEN_SOURCE). */
const ownsArtifactStem = (stem) =>
  REGISTRY.find((e) => typeof e.resolve === 'function') &&
  stem.includes('__') &&
  /\.spec\.mjs$/.test(stem)
    ? 'upstream-sweep'
    : null;

const findForWhy = (arg) => {
  const byName = REGISTRY.find((e) => e.name === arg);
  if (byName) return { entry: byName, how: 'registry name' };
  const byArtifact = ownsArtifactStem(arg);
  if (byArtifact) return { entry: REGISTRY.find((e) => e.name === byArtifact), how: 'artifact stem' };
  return null;
};

const printList = () => {
  for (const e of REGISTRY) {
    const dead = e.legs.filter((l) => l.status === 'dead').length;
    const deadNote = dead > 0 ? ` (${dead} dead leg(s) — see --why)` : '';
    console.log(`${e.name} — counts from ${e.countsFrom}${deadNote}`);
  }
};

const printWhy = (entry) => {
  console.log(`${entry.name}: ${entry.what}`);
  console.log('');
  console.log(`counts from: ${entry.countsFrom}`);
  for (const leg of entry.legs) {
    if (leg.status === 'dead') {
      console.log(`dead leg:    ${leg.id} — ${leg.reason}`);
      console.log(`             (its runner: ${leg.runner})`);
    } else {
      console.log(`live leg:    ${leg.id} — ${leg.runner}`);
    }
  }
  if (entry.verdict) console.log(`verdict:     ${entry.verdict}`);
  if (entry.transpiler) console.log(`transpiler:  ${entry.transpiler}`);
  if (entry.flatten) console.log(`flatten:     ${entry.flatten}`);
  if (entry.platform) console.log(`platform:    ${entry.platform}`);
  if (entry.ci) console.log(`ci:          ${entry.ci}`);
  console.log(`evidence:    ${entry.evidence.join('; ')}`);
};

const printResolve = (arg) => {
  const resolvers = REGISTRY.filter((e) => typeof e.resolve === 'function');
  for (const entry of resolvers) {
    const flat = entry.resolve(arg);
    if (flat) {
      console.log(flat);
      return;
    }
  }
  console.log(
    `no registered entry resolves '${arg}'. Entries with a resolve function: ` +
      resolvers.map((e) => e.name).join(', '),
  );
};

const usage = (message) =>
  failLoud(
    `${message}\n` +
      'usage:\n' +
      '  node test/verifications.mjs --list\n' +
      '  node test/verifications.mjs --why <registry-name | artifact-stem>\n' +
      '  node test/verifications.mjs --resolve <tests-tree-relative-path>\n' +
      '  node test/verifications.mjs --check-fresh\n' +
      `registered names: ${NAMES.join(', ')}`,
  );

const printCheckFresh = () => {
  const staged = existsSync(GENERATION_STAMP)
    ? readFileSync(GENERATION_STAMP, 'utf8').trim()
    : 'missing';
  const now = computeFingerprint();
  if (staged === now) {
    console.log(`fresh (${now.slice(0, 12)})`);
    return;
  }
  failLoud(
    `staged upstream-tests are STALE (staged gen ${staged.slice(0, 12)} ≠ ` +
      `current ${now.slice(0, 12)}). Fix: run \`${TRANSPILER}\`, then re-run ` +
      'this check.',
  );
};

const runCli = (argv) => {
  if (argv.length === 0) usage('expected a flag');
  if (argv.length > 2) usage(`expected one flag and its value, got: ${argv.join(' ')}`);
  const [flag, value] = argv;
  if (flag === '--list') {
    if (value) usage(`--list takes no value, got '${value}'`);
    printList();
  } else if (flag === '--why') {
    if (!value) usage('--why needs a registry name or an artifact stem');
    const found = findForWhy(value);
    if (!found) usage(`unknown verification name or artifact stem '${value}'`);
    printWhy(found.entry);
  } else if (flag === '--resolve') {
    if (!value) usage('--resolve needs a tests-tree-relative path');
    printResolve(value);
  } else if (flag === '--check-fresh') {
    if (value) usage(`--check-fresh takes no value, got '${value}'`);
    printCheckFresh();
  } else {
    usage(`unknown flag '${flag}'`);
  }
};

/** CLI face — generation.mjs's entry-module guard with the argv side
 *  realpath'd (the ESM loader resolves symlinks in import.meta.url, argv[1]
 *  stays as typed; a symlinked checkout must not turn the CLI into a silent
 *  exit 0). Importing this file stays side-effect free; only a direct
 *  `node test/verifications.mjs` run dispatches the flags above. */
const isEntryModule = () => {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
};

if (isEntryModule()) {
  runCli(process.argv.slice(2));
}
