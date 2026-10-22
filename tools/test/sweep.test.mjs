// Hermetic net for tools/test/sweep.mjs (the upstream-sweep driver): pure
// parsing/rendering, pool concurrency, leg spawning over `node -e` pseudo
// legs, and one end-to-end runSweep over a tmp fixture. NOTHING here reads
// the vendored closure, calls the dsh-cli, or touches the repo — every
// mutable path lives under a mkdtemp seat, removed when its test ends.
// Flat top-level `it`s: the code-size gate counts callback bodies as
// functions, so no describe nesting and every body stays small.
import { expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  UsageError,
  agreeOf,
  classifyDisagreements,
  computeTotals,
  loadLedger,
  ensureFresh,
  extractSummary,
  parseArgs,
  parseFailed,
  renderPlan,
  renderReport,
  renderTotals,
  rowFor,
  runLeg,
  runPool,
  runSweep,
  sweepSpec,
} from './sweep.mjs';
import { computeFingerprint } from '../../test/verifications.mjs';

const seat = () => mkdtempSync(join(tmpdir(), 'sweep-test-'));
const cleanup = (dir) => rmSync(dir, { recursive: true, force: true });

/** A registry-shaped leg whose drive spawns `node -e` with the spec name
 * appended, so a test can script deterministic summaries per name. */
const fakeLeg = (column, pattern, pick, script, { retries = 0, requires = null } = {}) => ({
  id: column === 'qjs' ? 'qjs' : 'node-differential',
  column,
  drive: { cwd: '.', requires, retries, summary: { pattern, pick }, argv: (name) => script(name) },
});

const RETRY_PSEUDO_CODE =
  'const fs = require("node:fs"); if (fs.existsSync(process.argv[1])) ' +
  '{ console.log("SUM {\\"failed\\":1}"); } else { fs.writeFileSync(process.argv[1], "ran"); }';

/** The retry-once face: run 1 writes the marker and prints NOTHING; the
 * retry sees the marker and prints the summary — exactly "no summary,
 * then one". */
const retryOnceQjsLeg = (marker) =>
  fakeLeg('qjs', 'SUM \\{.*\\}', 'last', () => ['node', '-e', RETRY_PSEUDO_CODE, marker], { retries: 1 });

/** Run 1 writes the marker and HANGS (the driver's timeout kills it); the
 * retry sees the marker and prints the summary. */
const HANG_THEN_SUMMARY_CODE =
  'const fs = require("node:fs"); if (fs.existsSync(process.argv[1])) { console.log("SUM {\\"failed\\":1}"); } ' +
  'else { fs.writeFileSync(process.argv[1], "ran"); setInterval(() => {}, 1000); }';

/** Counts its own runs in a file; prints the summary on the THIRD run. */
const THIRD_RUN_SUMMARY_CODE =
  'const fs = require("node:fs"); const p = process.argv[1]; ' +
  'const n = (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "") + "x"; fs.writeFileSync(p, n); ' +
  'if (n.length >= 3) console.log("SUM {\\"failed\\":1}");';

const NODE_SUMMARY_LEG = fakeLeg('node', 'SUM \\{.*\\}', 'first', () => [
  'node',
  '-e',
  'console.log("SUM {\\"failed\\":1}");',
]);

const specContext = (root, legs) => {
  const logDir = join(root, 'logs');
  const fragsDir = join(logDir, 'fragments');
  mkdirSync(fragsDir, { recursive: true });
  return { root, legs, logDir, fragsDir, specSuffix: '.spec.mjs', legTimeoutMs: 5000 };
};

/** The end-to-end fixture: three fake specs (plus a non-spec file that
 * discovery must ignore) and two deterministic pseudo legs. c-third's qjs
 * leg prints NO summary — the harness-error face whose cell reads
 * TIMEOUT-OR-ERROR; b-second's differential exits 1 after printing its
 * summary — the case bash's `&& grep` flattened (delta 1). */
const buildFixture = () => {
  const root = seat();
  const specsDir = join(root, 'upstream-tests');
  mkdirSync(specsDir);
  for (const stem of ['c-third', 'a-first', 'b-second']) {
    writeFileSync(join(specsDir, `${stem}.spec.mjs`), '// fake spec\n');
  }
  writeFileSync(join(specsDir, 'notes.txt'), 'not a spec — never discovered\n');
  const qjsLeg = fakeLeg('qjs', 'QJS \\{.*\\}', 'last', (name) => [
    'node',
    '-e',
    'const n = process.argv[1]; if (n.startsWith("c")) process.exit(0); ' +
      'const f = n.startsWith("a") ? 0 : 2; console.log("QJS {\\"failed\\":" + f + "}");',
    name,
  ]);
  // (legs receive the full spec FILENAME, bash-verbatim — hence startsWith,
  // not equality)
  const nodeLeg = fakeLeg('node', 'NODE \\{.*\\}', 'first', (name) => [
    'node',
    '-e',
    'const n = process.argv[1]; console.log("NODE {\\"failed\\":0}"); if (n.startsWith("b")) process.exit(1);',
    name,
  ]);
  return { root, specsDir, legs: [qjsLeg, nodeLeg], out: join(root, 'out') };
};

const runFixture = async (overrides = {}) => {
  const fx = buildFixture();
  const options = { root: fx.root, legs: fx.legs, freshness: null, specsDir: fx.specsDir, out: fx.out, parallel: 2 };
  const result = await runSweep({ ...options, ...overrides });
  return { fx, result };
};

it('parseArgs defaults to the bash shape: parallel unset, no filter, tmp out', () => {
  expect(parseArgs([])).toEqual({ parallel: null, filter: null, out: null, dryRun: false });
});

it('parseArgs parses --paral/--filter/--out/--dry-run', () => {
  expect(parseArgs(['--paral', '7', '--filter', 'subprocess', '--out', 'scratch', '--dry-run']))
    .toEqual({ parallel: 7, filter: 'subprocess', out: 'scratch', dryRun: true });
});

it('parseArgs fails loud on unknown flags, missing values and bad widths (exit 2 class)', () => {
  expect(() => parseArgs(['--wat'])).toThrow(UsageError);
  expect(() => parseArgs(['--paral'])).toThrow(UsageError);
  expect(() => parseArgs(['--paral', 'x'])).toThrow(UsageError);
  expect(() => parseArgs(['--paral', '0'])).toThrow(UsageError);
});

it('extractSummary mirrors grep -o | (head|tail) -1: matched part only', () => {
  const text = 'noise\npre "event":"suite/summary",a:1\n"event":"suite/summary",b:2\n';
  expect(extractSummary(text, { pattern: '"event":"suite/summary".*', pick: 'last' }))
    .toBe('"event":"suite/summary",b:2');
  expect(extractSummary(text, { pattern: '"event":"suite/summary".*', pick: 'first' }))
    .toBe('"event":"suite/summary",a:1');
  const greedy = 'harness smoke: {"failed":1} tail } x';
  expect(extractSummary(greedy, { pattern: 'harness smoke: \\{.*\\}', pick: 'first' }))
    .toBe('harness smoke: {"failed":1} tail }');
  expect(extractSummary('nothing here', { pattern: '"event":"suite/summary".*', pick: 'last' })).toBeNull();
  // CRLF leg output: the trailing \r never rides into the cell.
  expect(extractSummary('x\r\n"event":"suite/summary",c:3\r\n', { pattern: '"event":"suite/summary".*', pick: 'last' }))
    .toBe('"event":"suite/summary",c:3');
});

it('parseFailed takes the LAST "failed": like sed, digits or null', () => {
  expect(parseFailed('{"passed":31,"failed":0,"skipped":0}')).toBe(0);
  expect(parseFailed('{"failed":2} ... {"failed":5}')).toBe(5);
  expect(parseFailed('{"failed":12}')).toBe(12);
  expect(parseFailed('TIMEOUT-OR-ERROR')).toBeNull();
  expect(parseFailed('{"failed":null}')).toBeNull();
  expect(parseFailed(null)).toBeNull();
});

it('agreeOf: yes / NO / — exactly like the bash column', () => {
  expect(agreeOf(0, 0)).toBe('yes');
  expect(agreeOf(2, 3)).toBe('NO');
  expect(agreeOf(0, null)).toBe('—');
  expect(agreeOf(null, null)).toBe('—');
});

it('rowFor derives agreement from the two cells', () => {
  expect(rowFor('a', '{"failed":0}', '{"failed":0}').agree).toBe('yes');
  expect(rowFor('a', 'TIMEOUT-OR-ERROR', '{"failed":0}').agree).toBe('—');
  expect(rowFor('a', '{"failed":1}', '{"failed":0}').agree).toBe('NO');
});

it('renderReport emits the header and stem-sorted tab-separated rows', () => {
  const rows = [
    { stem: 'b-x', qjs: '{"failed":1}', node: '{"failed":1}', agree: 'yes' },
    { stem: 'a-x', qjs: '{"failed":0}', node: '{"failed":0}', agree: 'yes' },
  ];
  expect(renderReport(rows)).toBe(
    'spec\tqjs\tnode\tagree\n' +
      'a-x\t{"failed":0}\t{"failed":0}\tyes\n' +
      'b-x\t{"failed":1}\t{"failed":1}\tyes\n',
  );
});

it('computeTotals counts qjs-green from the QJS COLUMN ONLY (delta 2)', () => {
  const rows = [
    { stem: 'a', qjs: '{"failed":0}', node: '{"failed":0}', agree: 'yes' },
    { stem: 'b', qjs: 'TIMEOUT-OR-ERROR', node: '{"failed":0}', agree: '—' },
    { stem: 'c', qjs: '{"failed":2}', node: '{"failed":0}', agree: 'NO' },
  ];
  // bash's column-blind whole-row grep would have said 3; the driver says 1.
  expect(computeTotals(rows)).toEqual({ specs: 3, qjsGreen: 1, disagreements: 1 });
});

it('renderTotals reproduces the bash block: four segments, 3-line note', () => {
  expect(renderTotals({ specs: 3, qjsGreen: 1, disagreements: 1 }, 'tmp/r.tsv')).toBe(
    [
      'specs: 3',
      'qjs specs with a green summary: 1 (see the note for the',
      '  three-way classification: green / partial / module-gap —',
      '  module-gap rows carry no summary by construction)',
      'failed-count disagreements (qjs vs node): 1',
      'report: tmp/r.tsv',
      '',
    ].join('\n'),
  );
});

it('runPool caps concurrency at width and completes every item in order', async () => {
  let active = 0;
  let peak = 0;
  const results = await runPool([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 5));
    active -= 1;
    return n * 10;
  });
  expect(peak).toBeLessThanOrEqual(3);
  expect(results).toEqual([10, 20, 30, 40, 50, 60, 70]);
});

it('runPool propagates a worker failure (after every lane settles)', async () => {
  const failer = async (n) => {
    if (n === 2) throw new Error('boom');
    return n;
  };
  await expect(runPool([1, 2], 2, failer)).rejects.toThrow('boom');
});

it('runLeg extracts the summary even on exit 1 and appends the exit line (delta 1)', async () => {
  const root = seat();
  const leg = fakeLeg('node', 'SM \\{.*\\}', 'first', () => [
    'node',
    '-e',
    'console.log("SM {\\"failed\\":3}"); process.exit(1);',
  ]);
  const logPath = join(root, 'x.node.log');
  const result = await runLeg(leg, 'x.spec.mjs', { root, logPath, timeoutMs: 5000 });
  expect(result).toEqual({ summary: 'SM {"failed":3}', exitCode: 1, timedOut: false });
  expect(readFileSync(logPath, 'utf8')).toContain('sweep: exit=1 timedOut=false');
  cleanup(root);
});

it('runLeg SIGKILLs a hung leg past a short timeout and reports timedOut', async () => {
  const root = seat();
  const leg = fakeLeg('qjs', 'SM \\{.*\\}', 'last', () => ['node', '-e', 'setInterval(() => {}, 1000);']);
  const logPath = join(root, 'x.qjs.log');
  const result = await runLeg(leg, 'x.spec.mjs', { root, logPath, timeoutMs: 400 });
  expect(result.timedOut).toBe(true);
  expect(result.summary).toBeNull();
  expect(readFileSync(logPath, 'utf8')).toContain('sweep: exit=null timedOut=true');
  cleanup(root);
});

it('sweepSpec retries the qjs leg ONCE on empty summary, records the retry, keeps both logs', async () => {
  const root = seat();
  const ctx = specContext(root, [retryOnceQjsLeg(join(root, 'marker')), NODE_SUMMARY_LEG]);
  const row = await sweepSpec('dsh-x.spec.mjs', ctx);
  expect(row).toEqual({ stem: 'dsh-x', qjs: 'SUM {"failed":1}', node: 'SUM {"failed":1}', agree: 'yes' });
  expect(existsSync(join(ctx.logDir, 'dsh-x.qjs.log'))).toBe(true);
  expect(existsSync(join(ctx.logDir, 'dsh-x.qjs.retry.log'))).toBe(true);
  expect(existsSync(join(ctx.logDir, 'dsh-x.node.log'))).toBe(true);
  expect(readFileSync(join(ctx.logDir, 'dsh-x.qjs.log'), 'utf8')).not.toContain('SUM');
  expect(readFileSync(join(ctx.fragsDir, 'dsh-x.tsv'), 'utf8'))
    .toBe('dsh-x\tSUM {"failed":1}\tSUM {"failed":1}\tyes\n');
  cleanup(root);
});

it('sweepSpec grants no retry at retries: 0 — TIMEOUT-OR-ERROR recorded, no retry log', async () => {
  const root = seat();
  const silent = fakeLeg('qjs', 'SUM \\{.*\\}', 'last', () => ['node', '-e', 'process.exit(0);']);
  const row = await sweepSpec('only.spec.mjs', specContext(root, [silent, NODE_SUMMARY_LEG]));
  expect(row.qjs).toBe('TIMEOUT-OR-ERROR');
  expect(row.agree).toBe('—');
  expect(existsSync(join(root, 'logs', 'only.qjs.retry.log'))).toBe(false);
  cleanup(root);
});

it('sweepSpec records TIMEOUT-OR-ERROR when the retry ALSO brings no summary — exhaustion keeps both logs', async () => {
  const root = seat();
  const silent = fakeLeg('qjs', 'SUM \\{.*\\}', 'last', () => ['node', '-e', 'process.exit(0);'], { retries: 1 });
  const row = await sweepSpec('only.spec.mjs', specContext(root, [silent, NODE_SUMMARY_LEG]));
  expect(row.qjs).toBe('TIMEOUT-OR-ERROR');
  const retryLog = join(root, 'logs', 'only.qjs.retry.log');
  expect(readFileSync(retryLog, 'utf8')).toBe('sweep: exit=0 timedOut=false\n');
  cleanup(root);
});

it('sweepSpec retries after a TIMED-OUT first attempt and records the retry', async () => {
  const root = seat();
  const hang = fakeLeg('qjs', 'SUM \\{.*\\}', 'last', () => ['node', '-e', HANG_THEN_SUMMARY_CODE, join(root, 'marker')], {
    retries: 1,
  });
  const ctx = { ...specContext(root, [hang, NODE_SUMMARY_LEG]), legTimeoutMs: 400 };
  const row = await sweepSpec('hang.spec.mjs', ctx);
  expect(row.qjs).toBe('SUM {"failed":1}');
  expect(readFileSync(join(ctx.logDir, 'hang.qjs.log'), 'utf8')).toContain('sweep: exit=null timedOut=true');
  expect(readFileSync(join(ctx.logDir, 'hang.qjs.retry.log'), 'utf8')).toContain('timedOut=false');
  cleanup(root);
});

it('sweepSpec honours retries: 2 — three attempts, logs .retry.log then .retry2.log', async () => {
  const root = seat();
  const counting = fakeLeg('qjs', 'SUM \\{.*\\}', 'last', () => ['node', '-e', THIRD_RUN_SUMMARY_CODE, join(root, 'count')], {
    retries: 2,
  });
  const ctx = specContext(root, [counting, NODE_SUMMARY_LEG]);
  const row = await sweepSpec('tri.spec.mjs', ctx);
  expect(row.qjs).toBe('SUM {"failed":1}');
  for (const log of ['tri.qjs.log', 'tri.qjs.retry.log', 'tri.qjs.retry2.log']) {
    expect(existsSync(join(ctx.logDir, log))).toBe(true);
  }
  cleanup(root);
});

it('runSweep end to end: stem-sorted rows, agreement, totals — over the fixture', async () => {
  const { fx, result } = await runFixture();
  expect(result.rows.map((r) => r.stem)).toEqual(['a-first', 'b-second', 'c-third']);
  expect(result.rows.map((r) => r.agree)).toEqual(['yes', 'NO', '—']);
  expect(result.rows.map((r) => r.qjs)).toEqual([
    'QJS {"failed":0}',
    'QJS {"failed":2}',
    'TIMEOUT-OR-ERROR',
  ]);
  expect(result.rows.map((r) => r.node)).toEqual(['NODE {"failed":0}', 'NODE {"failed":0}', 'NODE {"failed":0}']);
  expect(result.totals).toEqual({ specs: 3, qjsGreen: 1, disagreements: 1 });
  cleanup(fx.root);
});

it('runSweep end to end: the TSV report and the totals file are the rendered rows', async () => {
  const { fx, result } = await runFixture();
  const report = readFileSync(result.reportPath, 'utf8');
  expect(report.split('\n')[0]).toBe('spec\tqjs\tnode\tagree');
  expect(report).toBe(renderReport(result.rows));
  const totalsText = readFileSync(result.totalsPath, 'utf8');
  // The classification (against the root's ledger — the fixture root has
  // none, so b-second lands unexplained) is part of the rendered block.
  expect(totalsText).toBe(renderTotals(result.totals, result.reportPath, result.classification));
  expect(result.classification.unexplained).toEqual(['b-second']);
  expect(totalsText).toContain('  unexplained: 1\n    UNEXPLAINED: b-second\n');
  expect(result.reportPath).toBe(join(fx.out, 'upstream-suite-report.tsv'));
  expect(result.totalsPath).toBe(join(fx.out, 'upstream-suite-report-totals.txt'));
  cleanup(fx.root);
});

it('classifyDisagreements splits the NO rows against the ledger and names stale rows', () => {
  const rows = [
    { stem: 'd-row', qjs: '{"failed":4}', node: '{"failed":0}', agree: 'NO' },
    { stem: 'c-row', qjs: '{"failed":1}', node: '{"failed":0}', agree: 'NO' },
    { stem: 'open-row', qjs: '{"failed":1}', node: '{"failed":0}', agree: 'NO' },
    { stem: 'fixed-row', qjs: '{"failed":0}', node: '{"failed":0}', agree: 'yes' },
  ];
  const ledger = {
    'd-row': { class: 'd-contract', note: 'worker_threads unavailable by design' },
    'c-row': { class: 'c-delta', note: 'real proxy routing' },
    'fixed-row': { class: 'c-delta', note: 'stale — the row flipped green' },
  };
  const classification = classifyDisagreements(rows, ledger);
  expect(classification.documented).toEqual(['d-row', 'c-row']);
  expect(classification.unexplained).toEqual(['open-row']);
  expect(classification.stale).toEqual(['fixed-row']);
  expect(classification.classes['d-contract']).toEqual(['d-row']);
  expect(classification.classes['c-delta']).toEqual(['c-row']);
  expect(classification.classes['both-red']).toEqual([]);
});

it('renderTotals renders the accounting lines with per-class counts', () => {
  const classification = {
    documented: ['d-row', 'c-row'],
    unexplained: ['open-row'],
    stale: ['fixed-row'],
    classes: { 'd-contract': ['d-row'], 'c-delta': ['c-row'], 'both-red': [] },
  };
  const text = renderTotals({ specs: 4, qjsGreen: 1, disagreements: 3 }, 'tmp/r.tsv', classification);
  expect(text).toBe(
    [
      'specs: 4',
      'qjs specs with a green summary: 1 (see the note for the',
      '  three-way classification: green / partial / module-gap —',
      '  module-gap rows carry no summary by construction)',
      'failed-count disagreements (qjs vs node): 3',
      '  documented by the differential ledger: 2 (d-contract 1, c-delta 1, both-red 0)',
      '  unexplained: 1',
      '    UNEXPLAINED: open-row',
      '    STALE LEDGER ROW (no longer disagreeing): fixed-row',
      'report: tmp/r.tsv',
      '',
    ].join('\n'),
  );
});

it('runSweep end to end: per-spec fragments and leg logs with the exit lines', async () => {
  const { fx, result } = await runFixture();
  const logDir = join(fx.out, 'upstream-suite-logs');
  expect(readdirSync(join(logDir, 'fragments')).sort()).toEqual(['a-first.tsv', 'b-second.tsv', 'c-third.tsv']);
  expect(readFileSync(join(logDir, 'b-second.node.log'), 'utf8')).toContain('sweep: exit=1 timedOut=false');
  expect(readFileSync(join(logDir, 'a-first.qjs.log'), 'utf8')).toContain('sweep: exit=0 timedOut=false');
  expect(existsSync(join(logDir, 'c-third.qjs.retry.log'))).toBe(false);
  cleanup(fx.root);
});

it('runSweep dry-run returns a plan (filtered discovery included) and writes nothing', async () => {
  const { fx, result } = await runFixture({ dryRun: true, parallel: 9, filter: 'second' });
  expect(result.plan.dryRun).toBe(true);
  expect(result.plan.specs).toEqual(['b-second.spec.mjs']);
  expect(result.plan.parallel).toBe(9);
  expect(result.plan.legs).toEqual(['qjs', 'node-differential']);
  expect(existsSync(fx.out)).toBe(false);
  cleanup(fx.root);
});

it('runSweep fails loud naming sh src/build.sh when a required binary is absent (delta 3)', async () => {
  const root = seat();
  const leg = fakeLeg('qjs', 'QJS \\{.*\\}', 'last', () => ['node', '-e', 'process.exit(0);'], {
    requires: 'no/such/binary',
  });
  await expect(runSweep({ root, legs: [leg], freshness: null, specsDir: root, out: root }))
    .rejects.toThrow(/requires no\/such\/binary.*sh src\/build\.sh/s);
  cleanup(root);
});

it('runSweep fails loud on a missing or spec-less specs dir (delta 3)', async () => {
  const root = seat();
  await expect(runSweep({ root, legs: [], freshness: null, specsDir: join(root, 'absent'), out: root }))
    .rejects.toThrow(/specs dir missing/);
  mkdirSync(join(root, 'empty'));
  await expect(runSweep({ root, legs: [], freshness: null, specsDir: join(root, 'empty'), out: root }))
    .rejects.toThrow(/no \*\.spec\.mjs specs/);
  cleanup(root);
});

it('runSweep validates legs up front, naming the offender (delta 3)', async () => {
  const root = seat();
  const run = (legs) => runSweep({ root, legs, freshness: null, specsDir: root, out: root });
  await expect(run([{ id: 'broken', column: 'qjs', drive: {} }])).rejects.toThrow(/leg 'broken' carries no drive\.argv/);
  await expect(run([fakeLeg('other', 'Q', 'last', () => ['true'])]))
    .rejects.toThrow(/leg 'node-differential' declares column 'other'/);
  await expect(run([fakeLeg('qjs', 'Q', 'last', () => ['true'], { retries: -1 })])).rejects.toThrow(/retries '-1'/);
  cleanup(root);
});

it('dry-run never dies on discovery: a missing specs dir lands in plan.discoveryError; renderPlan is JSON', async () => {
  const root = seat();
  const { plan } = await runSweep({ root, legs: [], freshness: null, specsDir: join(root, 'absent'), out: root, dryRun: true });
  expect(plan.specs).toEqual([]);
  expect(plan.discoveryError).toMatch(/specs dir missing/);
  expect(renderPlan(plan)).toContain('"dryRun": true');
  expect(JSON.parse(renderPlan(plan)).discoveryError).toBe(plan.discoveryError);
  cleanup(root);
});

it('dry-run lists a missing required binary in plan.missingRequires instead of refusing to plan', async () => {
  const root = seat();
  const leg = fakeLeg('qjs', 'Q', 'last', () => ['node', '-e', '0'], { requires: 'no/such/binary' });
  const { plan } = await runSweep({ root, legs: [leg], freshness: null, specsDir: root, out: root, dryRun: true });
  expect(plan.missingRequires).toEqual(['no/such/binary']);
  expect(plan.discoveryError).toMatch(/no \*\.spec\.mjs specs/);
  cleanup(root);
});

it('ensureFresh does nothing when the staged stamp matches the fingerprint', async () => {
  const root = seat();
  const now = computeFingerprint();
  writeFileSync(join(root, 'gen.stamp'), now);
  const drive = { freshness: { stamp: 'gen.stamp', refresh: [{ cwd: '.', argv: ['node', '-e', 'process.exit(1)'] }] } };
  const out = await ensureFresh({ root, drive, dryRun: false });
  expect(out).toEqual({ staged: now, now, stale: false, ranRefresh: false });
  cleanup(root);
});

it('ensureFresh prints the bash stale line and runs every refresh step in order on mismatch', async () => {
  const root = seat();
  const marker = join(root, 'marker');
  writeFileSync(join(root, 'gen.stamp'), 'stale-stamp-value');
  const drive = {
    freshness: {
      stamp: 'gen.stamp',
      refresh: [
        { cwd: '.', argv: ['node', '-e', 'require("node:fs").writeFileSync(process.argv[1], "one")', marker] },
        { cwd: '.', argv: ['node', '-e', 'require("node:fs").appendFileSync(process.argv[1], "two")', marker] },
      ],
    },
  };
  const logged = [];
  const spy = vi.spyOn(console, 'log').mockImplementation((...parts) => logged.push(parts.join(' ')));
  try {
    const out = await ensureFresh({ root, drive, dryRun: false });
    expect(out.stale).toBe(true);
    expect(out.ranRefresh).toBe(true);
    expect(readFileSync(marker, 'utf8')).toBe('onetwo');
  } finally {
    spy.mockRestore();
  }
  expect(logged.join('\n')).toContain('sweep: staged upstream-tests stale (gen stale-stamp-');
  expect(logged.join('\n')).toContain('— re-transpiling');
  cleanup(root);
});

it('ensureFresh aborts with a SweepFailure when a refresh step fails (delta 4)', async () => {
  const root = seat();
  writeFileSync(join(root, 'gen.stamp'), 'stale-stamp-value');
  const drive = { freshness: { stamp: 'gen.stamp', refresh: [{ cwd: '.', argv: ['node', '-e', 'process.exit(3)'] }] } };
  const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    await expect(ensureFresh({ root, drive, dryRun: false })).rejects.toThrow(/freshness step failed.*exit 3/s);
  } finally {
    spy.mockRestore();
  }
  cleanup(root);
});

it('ensureFresh dryRun compares only — a stale stamp triggers no refresh step', async () => {
  const root = seat();
  writeFileSync(join(root, 'gen.stamp'), 'stale-stamp-value');
  const drive = {
    freshness: {
      stamp: 'gen.stamp',
      refresh: [
        { cwd: '.', argv: ['node', '-e', 'require("node:fs").writeFileSync(process.argv[1], "RAN")', join(root, 'marker')] },
      ],
    },
  };
  const out = await ensureFresh({ root, drive, dryRun: true });
  expect(out.stale).toBe(true);
  expect(out.ranRefresh).toBe(false);
  expect(existsSync(join(root, 'marker'))).toBe(false);
  cleanup(root);
});
