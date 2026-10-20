// dsh:logging-exempt (dev script: its stdout is the report)
/**
 * sweep.mjs — the Node driver for the FULL upstream dsh-tests sweep, both
 * legs: every transpiled spec under runtime/dsh/upstream-tests/ runs in a
 * bounded pool against the QuickJS CLI (scenario upstream.suite) AND under
 * plain Node (the differential reference); output is a TSV report plus a
 * totals block under tmp/ — a diagnostic, NOT committed evidence.
 *
 * This sinks the orchestration of runtime/dsh/ci/run-upstream-suite-sweep.sh
 * (2026-10-20), which stays on as a `sh` shim exec'ing this file. The
 * recipes — per-leg argv, summary patterns, retries, the freshness refresh
 * steps — live in the registry: test/verifications.mjs, entry
 * `upstream-sweep` (its `drive` block plus per-leg `column`/`drive`); this
 * driver only executes them and adds the CLI.
 *
 * Deliberate deltas vs the bash sweep — none silent; the Agent Note
 * (2026-10-20, testing) declares the same numbered list:
 * 1. The summary is extracted regardless of the exit code; the exit outcome
 *    is appended as a final `sweep: exit=<code> timedOut=<bool>` log line.
 *    Bash's `cmd > log && grep` blanked a cell on ANY nonzero exit — the
 *    node leg (smoke.mjs exits 1 on failures) lost its column, the qjs leg
 *    (dsh-cli exits 1 when failed > 0, AFTER the summary) lost AND retried
 *    every failing spec. Both cells now carry {"failed":N}; the retry fires
 *    only on a genuine no-summary (timeout, harness error).
 * 2. "qjs green" counts the qjs column only (bash grepped whole rows).
 * 3. Fail loud (rule 5) where bash degraded silently: required binary
 *    missing (exit 1, naming `sh src/build.sh`), missing/empty specs dir
 *    (exit 1), malformed registry leg (exit 1, naming it). Unknown flags
 *    exit 2 as bash did. Everything else writes the report and exits 0 —
 *    the sweep is an inspection, not a gate.
 * 4. A failed refresh step aborts (bash swept on with stale specs); the
 *    steps' output is not silenced (bash hid npm install's).
 * 5. Rows sort by stem in JS code-unit order (bash `sort`: locale-bound);
 *    consumers key rows by stem.
 * 6. Legs write to one log fd and are awaited on EXIT, not `close`.
 *
 * usage: node tools/test/sweep.mjs [--paral N] [--filter S] [--out DIR] [--dry-run]
 */

import { spawn, spawnSync } from 'node:child_process';
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REGISTRY, computeFingerprint } from '../../test/verifications.mjs';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SWEEP_ENTRY = 'upstream-sweep';
const NO_SUMMARY = 'TIMEOUT-OR-ERROR';
const USAGE = 'usage: node tools/test/sweep.mjs [--paral N] [--filter S] [--out DIR] [--dry-run]';

/** An unrecognized or malformed CLI flag — the caller exits 2. */
export class UsageError extends Error {}

/** A fail-loud refusal to run, carrying its own exit code (rule 5). */
export class SweepFailure extends Error {
  constructor(exitCode, message) {
    super(message);
    this.exitCode = exitCode;
  }
}

/** The CLI surface: --paral N (default: the registry's defaultParallel),
 * --filter S (spec-filename substring), --out DIR (default tmp/),
 * --dry-run. Unknown or malformed flags throw UsageError (exit 2). */
export const parseArgs = (argv) => {
  const parsed = { parallel: null, filter: null, out: null, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = () => {
      if (i + 1 >= argv.length) throw new UsageError(`flag '${flag}' needs a value`);
      i += 1;
      return argv[i];
    };
    if (flag === '--paral') {
      const width = Number(value());
      if (!Number.isInteger(width) || width < 1) {
        throw new UsageError(`--paral needs an integer >= 1, got '${argv[i]}'`);
      }
      parsed.parallel = width;
    } else if (flag === '--filter') {
      parsed.filter = value();
    } else if (flag === '--out') {
      parsed.out = value();
    } else if (flag === '--dry-run') {
      parsed.dryRun = true;
    } else {
      throw new UsageError(`unknown flag '${flag}'`);
    }
  }
  return parsed;
};

/** grep -o '<pattern>' | (head|tail) -1 over captured output: the matched
 * substring (never the whole line), one candidate per matching line, first
 * or last per `pick`. No match -> null. A trailing \r is dropped per line
 * (CRLF leg output must not carry a \r into a TSV cell). */
export const extractSummary = (text, { pattern, pick }) => {
  const re = new RegExp(pattern);
  const matches = [];
  for (const raw of String(text).split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    const found = re.exec(line);
    if (found) matches.push(found[0]);
  }
  if (matches.length === 0) return null;
  return pick === 'first' ? matches[0] : matches[matches.length - 1];
};

/** The "failed" count a summary cell reports, or null. sed's greedy `.*`
 * anchors on the LAST occurrence of "failed": — mirrored here so a doubled
 * summary parses exactly like the bash sweep's did. */
export const parseFailed = (summary) => {
  if (typeof summary !== 'string') return null;
  const at = summary.lastIndexOf('"failed":');
  if (at === -1) return null;
  const digits = /^\d+/.exec(summary.slice(at + '"failed":'.length));
  return digits ? Number(digits[0]) : null;
};

/** The agree column: 'yes' when both legs parsed and match, 'NO' when both
 * parsed and differ, '—' when either side carries no count. */
export const agreeOf = (qjsFailed, nodeFailed) => {
  if (qjsFailed === null || nodeFailed === null) return '—';
  return qjsFailed === nodeFailed ? 'yes' : 'NO';
};

/** One report row from the two summary cells; agreement derived. */
export const rowFor = (stem, qjs, node) => ({
  stem,
  qjs,
  node,
  agree: agreeOf(parseFailed(qjs), parseFailed(node)),
});

/** The TSV: header + rows sorted by stem in code-unit order (DELTA 5: bash
 * `sort` was locale-bound; consumers key rows by stem, never position). */
export const renderReport = (rows) => {
  const sorted = [...rows].sort((a, b) => (a.stem < b.stem ? -1 : a.stem > b.stem ? 1 : 0));
  const lines = [
    'spec\tqjs\tnode\tagree',
    ...sorted.map((r) => `${r.stem}\t${r.qjs}\t${r.node}\t${r.agree}`),
  ];
  return `${lines.join('\n')}\n`;
};

/** Totals over the rows. DELTA 2: the qjs-green count reads the qjs
 * column ONLY — bash grepped whole report rows, so a green node cell
 * counted toward qjs. */
export const computeTotals = (rows) => ({
  specs: rows.length,
  qjsGreen: rows.filter((r) => r.qjs.includes('"failed":0')).length,
  disagreements: rows.filter((r) => r.agree === 'NO').length,
});

/** The totals block — the bash sweep's exact four segments (the second
 * carrying its three-line parenthetical note, verbatim). */
export const renderTotals = (totals, reportPath) =>
  `specs: ${totals.specs}\n` +
  `qjs specs with a green summary: ${totals.qjsGreen} (see the note for the\n` +
  '  three-way classification: green / partial / module-gap —\n' +
  '  module-gap rows carry no summary by construction)\n' +
  `failed-count disagreements (qjs vs node): ${totals.disagreements}\n` +
  `report: ${reportPath}\n`;

/** Bounded-concurrency pool: at most `width` workers in flight, every item
 * processed exactly once, results in input order. A worker rejection fails
 * the pool only after every lane settles. No clocks — the only waiting is
 * on the worker promises (rule 8). */
export const runPool = async (items, width, worker) => {
  const results = new Array(items.length);
  let next = 0;
  const lane = async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  };
  const lanes = Array.from({ length: Math.max(1, Math.min(width, items.length)) }, lane);
  const settled = await Promise.allSettled(lanes);
  const failure = settled.find((s) => s.status === 'rejected');
  if (failure) throw failure.reason;
  return results;
};

/** One leg attempt: spawn (NO shell), stdout+stderr on ONE opened log fd
 * (bash's `> log 2>&1`: no pipe to drain, no interleaving), SIGKILLed past
 * timeoutMs by child_process's own timeout option; resolves on the child's
 * EXIT, never `close`, so a grandchild holding the inherited fd cannot hold
 * the lane (DELTA 6). Resolves {summary, exitCode, timedOut} (DELTA 1). */
export const runLeg = (leg, name, { root, logPath, timeoutMs }) =>
  new Promise((done, fail) => {
    const argv = leg.drive.argv(name);
    const logFd = openSync(logPath, 'w');
    let fdOpen = true;
    const release = () => {
      if (fdOpen) closeSync(logFd);
      fdOpen = false;
    };
    const child = spawn(argv[0], argv.slice(1), {
      cwd: join(root, leg.drive.cwd),
      timeout: timeoutMs,
      killSignal: 'SIGKILL',
      stdio: ['ignore', logFd, logFd],
    });
    let timedOut = false;
    child.on('error', (error) => {
      if (error.code === 'ETIMEDOUT') {
        timedOut = true;
        return;
      }
      release();
      fail(new SweepFailure(1, `sweep: leg '${leg.id}' could not start (${argv[0]}): ${error.message}`));
    });
    child.on('exit', (code, signal) => {
      try {
        release();
        // Node 24 probe: the timeout kill emits NO error event; the child just
        // exits (code=null, signal=SIGKILL) — that IS the timeout receipt.
        const killed = timedOut || (code === null && signal === 'SIGKILL');
        const codeText = code === null ? 'null' : String(code);
        const output = readFileSync(logPath, 'utf8');
        appendFileSync(logPath, `sweep: exit=${codeText} timedOut=${killed}\n`);
        const summary = leg.drive.summary ? extractSummary(output, leg.drive.summary) : null;
        done({ summary, exitCode: code, timedOut: killed });
      } catch (error) {
        fail(error);
      }
    });
  });

/** Retry n's log: bash's `.retry.log` for the first, `.retry<n>.log` after. */
const retryLogPath = (logPath, n) =>
  logPath.replace(/\.log$/, n === 1 ? '.retry.log' : `.retry${n}.log`);

/** First attempt, then up to `retries` immediate same-slot retries while no
 * summary arrives; the LAST attempt is recorded, earlier logs stay intact. */
const attemptWithRetry = async (leg, name, ctx, logPath) => {
  const retries = leg.drive.retries ?? 0;
  const timeoutMs = ctx.legTimeoutMs;
  let attempt = await runLeg(leg, name, { root: ctx.root, logPath, timeoutMs });
  for (let n = 1; attempt.summary === null && n <= retries; n++) {
    attempt = await runLeg(leg, name, { root: ctx.root, logPath: retryLogPath(logPath, n), timeoutMs });
  }
  return attempt;
};

/** Both legs of one spec, in the registry's slot order (qjs, then the
 * node differential); writes the spec's fragment; returns its row. */
export const sweepSpec = async (name, ctx) => {
  const stem = name.slice(0, name.length - ctx.specSuffix.length);
  const cells = {};
  for (const leg of ctx.legs) {
    const logPath = join(ctx.logDir, `${stem}.${leg.column}.log`);
    const attempt = await attemptWithRetry(leg, name, ctx, logPath);
    cells[leg.column] = attempt.summary === null ? NO_SUMMARY : attempt.summary;
  }
  const row = rowFor(stem, cells.qjs ?? NO_SUMMARY, cells.node ?? NO_SUMMARY);
  writeFileSync(join(ctx.fragsDir, `${stem}.tsv`), `${row.stem}\t${row.qjs}\t${row.node}\t${row.agree}\n`);
  return row;
};

/** The sweep's universe: specsDir's DIRECT children ending in specSuffix
 * (find -maxdepth 1), byte-order sorted, --filter keeping filename
 * substrings. A missing dir or an empty result fails loud naming it. */
export const discoverSpecs = (specsDir, { specSuffix, filter }) => {
  if (!existsSync(specsDir)) {
    throw new SweepFailure(1, `sweep: specs dir missing: ${specsDir} — run the transpiler first`);
  }
  const names = readdirSync(specsDir).filter((f) => f.endsWith(specSuffix));
  const kept = filter ? names.filter((f) => f.includes(filter)) : names;
  if (kept.length === 0) {
    const why = filter ? ` (filter '${filter}' kept none of ${names.length})` : '';
    throw new SweepFailure(1, `sweep: no *${specSuffix} specs in ${specsDir}${why}`);
  }
  return kept.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
};

const runStep = ({ root, cwd, argv }) =>
  spawnSync(argv[0], argv.slice(1), { cwd: join(root, cwd), stdio: 'inherit' }).status ?? 1;

/** The freshness gate, re-interpreted from bash: compare the staged stamp
 * against computeFingerprint(); on mismatch print the bash line and run
 * the registry's refresh steps in order. A failed refresh step aborts
 * (DELTA 4 — bash would have swept on with stale specs). dryRun computes
 * the comparison and runs nothing. */
export const ensureFresh = async ({ root, drive, dryRun }) => {
  const stampPath = join(root, drive.freshness.stamp);
  const staged = existsSync(stampPath) ? readFileSync(stampPath, 'utf8').trim() : 'missing';
  const now = computeFingerprint();
  if (dryRun || staged === now) return { staged, now, stale: staged !== now, ranRefresh: false };
  console.log(
    `sweep: staged upstream-tests stale (gen ${staged.slice(0, 12)} ≠ ${now.slice(0, 12)}) — re-transpiling`,
  );
  for (const step of drive.freshness.refresh) {
    const status = runStep({ root, cwd: step.cwd, argv: step.argv });
    if (status !== 0) {
      throw new SweepFailure(
        1,
        `sweep: freshness step failed (exit ${status}): ${step.argv.join(' ')} (cwd ${step.cwd})`,
      );
    }
  }
  return { staged, now, stale: true, ranRefresh: true };
};

const COLUMNS = ['qjs', 'node'];

/** DELTA 3: legs validated up front, offender named (rule 5); the binary
 * requirement is enforced on real runs only (dry-run lists it instead). */
const checkLegs = (root, legs, { requireBinaries }) => {
  for (const leg of legs) {
    const who = `sweep: leg '${leg.id ?? '<unnamed>'}'`;
    if (!leg.drive || typeof leg.drive.argv !== 'function') {
      throw new SweepFailure(1, `${who} carries no drive.argv(name) recipe`);
    }
    if (!COLUMNS.includes(leg.column)) {
      throw new SweepFailure(1, `${who} declares column '${leg.column}'; the report has only ${COLUMNS.join('/')}`);
    }
    const retries = leg.drive.retries ?? 0;
    if (!Number.isInteger(retries) || retries < 0) {
      throw new SweepFailure(1, `${who} declares retries '${leg.drive.retries}'; expected an integer >= 0`);
    }
    const requires = leg.drive.requires;
    if (requireBinaries && requires && !existsSync(join(root, requires))) {
      throw new SweepFailure(1, `${who} requires ${requires}, which is missing — build it first: sh src/build.sh`);
    }
  }
};

/** The report concatenates per-spec fragments; a stale fragment from a
 * killed previous run would ride into the report as a ghost row. Clean
 * slate per run (the bash sweep's `rm -f "$FRAGS"/*.tsv`). */
const clearFragments = (fragsDir) => {
  mkdirSync(fragsDir, { recursive: true });
  for (const name of readdirSync(fragsDir)) {
    if (name.endsWith('.tsv')) rmSync(join(fragsDir, name));
  }
};

const outPaths = (drive, outDir) => ({
  report: join(outDir, basename(drive.out.report)),
  totals: join(outDir, basename(drive.out.totals)),
  logDir: join(outDir, basename(drive.out.logDir)),
});

/** Resolve the run's immutable context from options + the registry entry. */
const sweepContext = (options) => {
  const entry = (options.registry ?? REGISTRY).find((e) => e.name === SWEEP_ENTRY);
  if (!entry || !entry.drive) {
    throw new SweepFailure(1, `sweep: registry entry '${SWEEP_ENTRY}' (with a drive block) not found`);
  }
  const root = options.root ?? REPO_ROOT;
  const drive = entry.drive;
  const outDir = options.out ? resolve(options.out) : dirname(join(root, drive.out.report));
  return {
    root,
    drive,
    legs: options.legs ?? entry.legs,
    specSuffix: drive.specSuffix,
    legTimeoutMs: drive.legTimeoutMs,
    outDir,
    paths: outPaths(drive, outDir),
    specsDir: options.specsDir ? resolve(options.specsDir) : join(root, drive.specsDir),
    parallel: options.parallel ?? drive.defaultParallel,
    filter: options.filter ?? null,
    dryRun: options.dryRun === true,
  };
};

/** --dry-run: what the run WOULD do, including what it would have died on. */
const buildPlan = (ctx, fresh, specs, discoveryError) => ({
  dryRun: true,
  parallel: ctx.parallel,
  filter: ctx.filter,
  freshness: fresh,
  legs: ctx.legs.map((leg) => leg.id),
  missingRequires: ctx.legs
    .map((leg) => leg.drive.requires)
    .filter((required) => required && !existsSync(join(ctx.root, required))),
  specsDir: ctx.specsDir,
  specs,
  discoveryError,
  outDir: ctx.outDir,
  reportPath: ctx.paths.report,
  totalsPath: ctx.paths.totals,
  logDir: ctx.paths.logDir,
});

/** The --dry-run product on stdout: the plan as indented JSON. */
export const renderPlan = (plan) => `${JSON.stringify(plan, null, 2)}\n`;

/** Dry-run never dies on discovery: the plan carries the loud message instead. */
const planDryRun = (ctx, fresh) => {
  try {
    const specs = discoverSpecs(ctx.specsDir, { specSuffix: ctx.specSuffix, filter: ctx.filter });
    return buildPlan(ctx, fresh, specs, null);
  } catch (error) {
    if (!(error instanceof SweepFailure)) throw error;
    return buildPlan(ctx, fresh, [], error.message);
  }
};

const executeSweep = async (ctx) => {
  const names = discoverSpecs(ctx.specsDir, { specSuffix: ctx.specSuffix, filter: ctx.filter });
  mkdirSync(ctx.paths.logDir, { recursive: true });
  const fragsDir = join(ctx.paths.logDir, 'fragments');
  clearFragments(fragsDir);
  const rows = await runPool(names, ctx.parallel, (name) =>
    sweepSpec(name, {
      root: ctx.root,
      legs: ctx.legs,
      logDir: ctx.paths.logDir,
      fragsDir,
      specSuffix: ctx.specSuffix,
      legTimeoutMs: ctx.legTimeoutMs,
    }),
  );
  mkdirSync(ctx.outDir, { recursive: true });
  writeFileSync(ctx.paths.report, renderReport(rows));
  const totals = computeTotals(rows);
  const totalsText = renderTotals(totals, ctx.paths.report);
  writeFileSync(ctx.paths.totals, totalsText);
  console.log(`sweep: DONE — ${ctx.paths.totals}`);
  process.stdout.write(totalsText);
  return { reportPath: ctx.paths.report, totalsPath: ctx.paths.totals, rows, totals };
};

/** The whole sweep. Injectable (root/registry/legs/freshness/specsDir/out/
 * parallel/filter/dryRun) for tests; `freshness: null` skips the gate.
 * Returns {reportPath, totalsPath, rows, totals}, or {plan} on --dry-run. */
export const runSweep = async (options = {}) => {
  const ctx = sweepContext(options);
  checkLegs(ctx.root, ctx.legs, { requireBinaries: !ctx.dryRun });
  const fresh =
    options.freshness === null
      ? { staged: null, now: null, stale: false, ranRefresh: false, skipped: true }
      : await (options.freshness ?? ensureFresh)({
          root: ctx.root,
          drive: ctx.drive,
          dryRun: ctx.dryRun,
        });
  if (ctx.dryRun) return { plan: planDryRun(ctx, fresh) };
  return executeSweep(ctx);
};

/** CLI face: parse, run, print the dry-run plan; exit 2 usage, 1 otherwise. */
const main = async (argv) => {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    console.error(`sweep: ${error.message}`);
    console.error(USAGE);
    process.exit(2);
  }
  try {
    const result = await runSweep(options);
    if (result.plan) process.stdout.write(renderPlan(result.plan));
  } catch (error) {
    const exitCode = error instanceof SweepFailure ? error.exitCode : 1;
    console.error(error instanceof SweepFailure ? error.message : `sweep: ${error.message}`);
    process.exit(exitCode);
  }
};

/** Entry-module guard with the argv side realpath'd: the ESM loader resolves
 * symlinks in import.meta.url, argv[1] stays as typed — through a symlinked
 * checkout the bare comparison made the CLI a silent exit 0 (rule 5). */
const isEntryModule = () => {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
};

if (isEntryModule()) {
  await main(process.argv.slice(2));
}
