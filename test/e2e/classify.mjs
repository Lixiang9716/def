#!/usr/bin/env node
/**
 * classify.mjs — the m1 harness verdict: is this red a PRODUCT regression or
 * an ENVIRONMENT stall? (#515.) check.mjs is the pure scenario checker; it
 * can only say "the expected events did not all appear". It cannot say WHY —
 * and #514's red was read as a product regression when the drive had merely
 * stopped (boot.verification 8/8 green, carrier.loopback 2/7 then silence,
 * every missing event a trailing expectation). This tool names the shapes the
 * checker's verdicts + the launch probes can actually distinguish, so the
 * harness answers honestly instead of either masking a regression as
 * "environment" or reddening the product for a dead simulator.
 *
 * The classification is a pure function of (verdicts, probes) — the same
 * property check.mjs has (log in, verdict out), so selftest.sh proves every
 * shape on fixtures in testdata/ and no simulator is needed to test the
 * harness. It runs ONLY inside the m1 leg (run-ios-m1.sh), on that attempt's
 * real checker outputs and measured probes — a receipt can never exist
 * without the run that produced it (write-receipt.sh's honesty law, and the
 * harmony matrix-skip precedent it mirrors, tools/test/run-simulator-matrix.sh).
 *
 * Rules, in order (fixture-proven in selftest.sh, rule 6):
 *   GREEN        every verdict pass. The captured log IS the verdict: a
 *                non-zero launch rc with a complete green log is the measured
 *                run-35610169977 class (launched, completed, then exited) —
 *                the rc rides the probes, it does not overrule the log.
 *   PRODUCT      any failing verdict carries product evidence: parseErrors
 *                (the app emitted malformed structured lines), a failure
 *                entry whose `logged` is a record (the event WAS logged but
 *                mismatched — the wrong-value class), or an `extra` entry
 *                (records past the expectations — divergence). A retry
 *                cannot fix a regression, so this wins over every
 *                environment shape.
 *   ENVIRONMENT  every failing verdict is silent-shaped (all failure entries
 *                logged:null, no parseErrors), and one of:
 *     app-never-ran    zero dsh.runtime.log lines captured (the existing
 *                      "the app never ran" gate, now a classified verdict);
 *     launch-crash     simctl launch exited non-zero (dyld-abort class —
 *                      measured, run 35610169977's root cause);
 *     scenario-silent  a failing scenario logged 0 of its expected events —
 *                      its first emit IS the factual scenario-start record
 *                      (runtime/dsh/scenario/boot-verification.js:29), so
 *                      "zero expected events AND no scenario-start" is this
 *                      count, not a new event (#515's discriminator, landed
 *                      without touching the frozen manifests);
 *     tail-stall       a failing scenario logged some events, then every
 *                      missing one is the contiguous trailing block — the
 *                      drive STOPPED, it did not mis-answer (the #514
 *                      attempt-1 shape: sibling boot 8/8 green on the same
 *                      launch).
 *   otherwise    PRODUCT — an unexplained red is a product red. The honest
 *                default: ambiguity resolves against "environment", and the
 *                retry-once (run-ios-m1.sh) is what disambiguates a flake
 *                from a regression, not a classifier's prophecy.
 *
 * The receipt (written ONLY when classification is environment, to --out)
 * mirrors the harmony matrix-skip receipt's shape: a full-sentence reason,
 * probes carrying the measured facts, the tree line, a producedAt — and the
 * four fields matrix.mjs reads from any verdict*.json (scenario string,
 * pass boolean, expected number, logged number — all false/summed here), so
 * if one is ever committed into an evidence dir the matrix gate sees an
 * honest pass:false and sends it to doc/e2e-matrix.md's known-gaps register,
 * never a fake green.
 *
 * Exit contract: 0 = green, 1 = product-class red, 2 = unusable input (rule
 * 5: a missing verdict names itself), 3 = environment-class red. run-ios-m1.sh
 * maps 3 to "retry once", 1 to "fail now".
 *
 * tools/ dev script (out of the logging gate's scope; console IS the product).
 *
 * usage: classify.mjs --verdict <v.json> [--verdict <v.json>...]
 *                     --launch-rc <n> --runtime-lines <n> --attempt <n>
 *                     [--ui-wait yes|no] [--sequence yes|no]
 *                     [--out <verdict-environment.json>]
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const usage = () => {
  console.error('usage: classify.mjs --verdict <json> [--verdict <json>...] --launch-rc <n> \\\n'
    + '                     --runtime-lines <n> --attempt <n> [--ui-wait yes|no] \\\n'
    + '                     [--sequence yes|no] [--out <json>]');
  process.exit(2);
};

const parseArgs = (argv) => {
  const args = { verdicts: [] };
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith('--') || argv[i + 1] === undefined) usage();
    const key = argv[i].slice(2);
    if (key === 'verdict') { args.verdicts.push(argv[i + 1]); continue; }
    args[key] = argv[i + 1];
  }
  if (!args.verdicts.length || args['launch-rc'] === undefined
    || args['runtime-lines'] === undefined || args.attempt === undefined) usage();
  return args;
};

const boolArg = (value) => {
  if (value === undefined) return false;
  if (value === 'yes' || value === 'true') return true;
  if (value === 'no' || value === 'false') return false;
  usage();
};

/** One verdict's classification facts, validated loud (rule 5). */
const loadVerdict = (path) => {
  let v;
  try {
    v = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    console.error(`classify: unusable verdict ${path}: ${e.message}`);
    process.exit(2);
  }
  for (const [k, t] of [['scenario', 'string'], ['pass', 'boolean'],
    ['expected', 'number'], ['logged', 'number']]) {
    if (typeof v[k] !== t) {
      console.error(`classify: ${path} is not a check.mjs verdict — "${k}" must be a ${t}`);
      process.exit(2);
    }
  }
  return v;
};

/** Product evidence inside ONE verdict: the app spoke and what it said was
 * wrong — malformed lines, a present-but-mismatched record, or records the
 * manifest never declared. Silence (logged:null entries) is NOT evidence. */
const hasProductEvidence = (v) => (v.parseErrors ?? []).length > 0
  || (v.failures ?? []).some((f) => f.logged !== null && f.logged !== undefined
    || Array.isArray(f.extra));

/** The silent shape's two forms. `silent` = the scenario never spoke (0/N).
 * `tailStall` = it spoke k>=1 events and EVERY missing expectation is the
 * contiguous trailing block — the drive stopped; a hole in the middle would
 * be the scenario skipping an event, which is product, not a stall. */
const silentShape = (v) => {
  if (v.pass) return 'none';
  if (v.logged === 0) return 'silent';
  const failed = (v.failures ?? []).filter((f) => !Array.isArray(f.extra));
  const stop = v.expected - failed.length;
  const contiguous = failed.every((f) => f.logged === null && f.index >= stop);
  return contiguous ? 'tail-stall' : 'product';
};

const treeLine = () => {
  try {
    const sha = execSync('git rev-parse --short=12 HEAD', { encoding: 'utf8' }).trim();
    const dirty = execSync('git diff-index --quiet HEAD --', { stdio: 'ignore' })
      ? ' (dirty working tree at receipt time)' : '';
    return `origin/main ${sha}${dirty}`;
  } catch {
    return 'unknown tree (git unavailable)';
  }
};

const classify = (verdicts, probes) => {
  if (verdicts.every((v) => v.pass === true)) {
    return { classification: 'green', shape: 'all-scenarios-pass', failing: null };
  }
  if (verdicts.some((v) => hasProductEvidence(v)) || verdicts.some((v) => silentShape(v) === 'product')) {
    return { classification: 'product', shape: 'assertion-failure', failing: verdicts.find((v) => !v.pass) };
  }
  const failing = verdicts.find((v) => !v.pass);
  if (probes.runtimeLines === 0) {
    return { classification: 'environment', shape: 'app-never-ran', failing };
  }
  if (probes.launchRc !== 0) {
    return { classification: 'environment', shape: 'launch-crash', failing };
  }
  if (verdicts.some((v) => silentShape(v) === 'silent')) {
    return { classification: 'environment', shape: 'scenario-silent', failing };
  }
  if (verdicts.some((v) => silentShape(v) === 'tail-stall')) {
    return { classification: 'environment', shape: 'tail-stall', failing };
  }
  return { classification: 'product', shape: 'unclassified-red', failing };
};

const REASONS = {
  'app-never-ran': 'the app never ran: 0 dsh.runtime.log lines were captured from this '
    + 'launch, so no scenario produced structured evidence and the red cannot be a '
    + 'product verdict. Never faked: pass stays false; the retry may earn the green, '
    + 'this attempt did not.',
  'launch-crash': 'the launch crashed: simctl launch exited non-zero, so the app died at '
    + 'or near launch and the missing events are the crash\'s, not a product '
    + 'regression\'s. Never faked: pass stays false; the retry may earn the green, '
    + 'this attempt did not.',
  'scenario-silent': '<scenario> never spoke: 0 of <expected> expected events were '
    + 'logged on this launch — the scenario\'s first emit is its factual start record, '
    + 'and it never landed, so the red cannot be a product verdict. Never faked: pass '
    + 'stays false; the retry may earn the green, this attempt did not.',
  'tail-stall': '<scenario> stalled mid-drive: <logged> of <expected> expected events '
    + 'were logged, and every missing one is the contiguous trailing block — the drive '
    + 'stopped, it did not mis-answer (the #514 attempt-1 shape: the sibling scenario '
    + 'completed green on the same launch). Never faked: pass stays false; the retry '
    + 'may earn the green, this attempt did not.',
  'assertion-failure': 'a scenario was logged and its record mismatched the manifest — '
    + 'the app mis-answered, which is a product red no retry can fix.',
  'unclassified-red': 'the red matches no environment shape this harness can name — the '
    + 'honest default is a product red, never a masked one.',
};

/** The receipt mirrors the harmony matrix-skip shape (full-sentence reason,
 * measured probes, tree, producedAt) plus the four fields matrix.mjs reads
 * from any verdict*.json — pass:false and honest sums, so a committed one
 * reads as an honest red in the matrix gate, never a fake green. */
const environmentReceipt = (verdicts, verdict, probes) => ({
  scenario: verdict.failing.scenario,
  pass: false,
  expected: verdicts.reduce((sum, v) => sum + v.expected, 0),
  logged: verdicts.reduce((sum, v) => sum + v.logged, 0),
  classification: 'environment',
  status: 'environment',
  leg: 'm1 simulator e2e (boot.verification + carrier.loopback, one launch)',
  reason: (REASONS[verdict.shape] ?? REASONS['unclassified-red'])
    .replaceAll('<scenario>', verdict.failing.scenario)
    .replaceAll('<expected>', String(verdict.failing.expected))
    .replaceAll('<logged>', String(verdict.failing.logged)),
  shape: verdict.shape,
  probes: {
    launchRc: probes.launchRc,
    'dsh.runtime.log lines': probes.runtimeLines,
    ...Object.fromEntries(verdicts.flatMap((v) => [
      [`${v.scenario} logged`, v.logged], [`${v.scenario} expected`, v.expected],
      [`${v.scenario} pass`, v.pass],
    ])),
    'rt: ui-wait marker': probes.uiWait,
    'rt: sequence marker': probes.sequence,
    attempt: probes.attempt,
  },
  tree: treeLine(),
  producedAt: new Date().toISOString(),
});

const main = () => {
  const args = parseArgs(process.argv.slice(2));
  const verdicts = args.verdicts.map(loadVerdict);
  const probes = {
    launchRc: Number(args['launch-rc']),
    runtimeLines: Number(args['runtime-lines']),
    attempt: Number(args.attempt),
    uiWait: boolArg(args['ui-wait']),
    sequence: boolArg(args['sequence']),
  };
  for (const [k, v] of Object.entries(probes)) {
    if (k === 'uiWait' || k === 'sequence') continue;
    if (!Number.isFinite(v)) { console.error(`classify: probe ${k} is not a number`); process.exit(2); }
  }
  const verdict = classify(verdicts, probes);
  const label = verdicts.map((v) => `${v.scenario} ${v.logged}/${v.expected}`).join(', ');
  if (verdict.classification === 'green') {
    console.log(`classify: GREEN — every scenario pass (${label}); launchRc=${probes.launchRc} `
      + `runtimeLines=${probes.runtimeLines}`);
    process.exit(0);
  }
  console.error(`classify: ${verdict.classification.toUpperCase()} — ${verdict.shape} `
    + `(${label}; launchRc=${probes.launchRc} runtimeLines=${probes.runtimeLines} `
    + `ui-wait=${probes.uiWait} sequence=${probes.sequence} attempt=${probes.attempt})`);
  if (verdict.classification !== 'environment') process.exit(1);
  const receipt = environmentReceipt(verdicts, verdict, probes);
  if (args.out) writeFileSync(args.out, JSON.stringify(receipt, null, 2) + '\n');
  process.exit(3);
};

main();
