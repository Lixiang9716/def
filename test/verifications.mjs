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
 *
 * Unknown names fail loud naming the offender (rule 5): exit 1.
 */

const FLATTEN_SOURCE = 'test/upstream-suite/transpile.mjs (line ~225)';
const flattenSpecPath = (rel) =>
  rel.split('/').join('__').replace(/\.spec\.ts$/, '.spec.mjs');

const REGISTRY = [
  {
    name: 'upstream-sweep',
    what: 'the FULL upstream dsh-tests suite sweep, both legs',
    countsFrom:
      'the qjs leg — runtime/dsh/ci/run-upstream-suite-sweep.sh running every transpiled ' +
      'spec through scenario upstream.suite (runtime/dsh/scenario/upstream-suite-leg.js)',
    legs: [
      {
        id: 'qjs',
        status: 'live',
        runner:
          'runtime/dsh/ci/run-upstream-suite-sweep.sh -> runtime/dsh/scenario/upstream-suite-leg.js',
      },
      {
        id: 'node-differential',
        status: 'dead',
        runner:
          'runtime/dsh/ci/run-upstream-suite-sweep.sh node leg (test/upstream-suite/smoke.mjs)',
        reason:
          'dsh-subprocess-local/index exports gap (the lsp-stdio family fails at module ' +
          'load; predates 2026-10-20)',
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
      `registered names: ${NAMES.join(', ')}`,
  );

const argv = process.argv.slice(2);
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
} else {
  usage(`unknown flag '${flag}'`);
}
