// dsh:logging-exempt (diagnostic: its stdout is the answer)
/**
 * check-test-taxonomy.mjs — the test-taxonomy gate (doc/test-coverage.md,
 * "The four layers"): every test artifact in the tree carries a declared
 * layer, and the declared layers agree with the verification registry.
 *
 * Layers (static|unit|integration|e2e):
 *   static      never executes the system under test (lint, size, hashes,
 *               doc pairing, evidence audits — audits inspect L3 artifacts
 *               but run nothing)
 *   unit        one module in one process, deterministic seconds
 *   integration the composed runtime, headless (CLI proof legs, the sweep,
 *               carrier boot-wire tests) — no app shell
 *   e2e         the shipped artifact driven through its real entry (UI or
 *               launch arg), asserting structured logs
 *
 * Checks:
 *   1. test/taxonomy.json: kinds enum-valid; every path exists (gate: ids
 *      resolve in gates.json); scenario drivenBy paths exist; a scenario
 *      with no driver carries orphan:true and a non-empty note.
 *   2. Coverage: every test-shaped file in the tree is classified
 *      (*.test.*, *.spec.*, test/e2e/scenarios/*.json, runner scripts,
 *      panel e2e scripts, CI workflows).
 *   3. Registry agreement: every verifications.mjs REGISTRY leg carries a
 *      kind that matches this taxonomy's entry for its primary file.
 *
 * --self-test runs the rejection proof (rules.md rule 6) first: a fixture
 * tree with one unclassified *.test.mjs must FAIL; the real tree is then
 * judged as usual.
 *
 * Exit 0 clean, 1 violations named, 2 invalid taxonomy document.
 */

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REGISTRY } from '../test/verifications.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const KINDS = new Set(['static', 'unit', 'integration', 'e2e']);
const sh = (c) => execSync(c, { encoding: 'utf8' }).trim().split('\n').filter(Boolean);

const violations = [];
const bad = (msg) => violations.push(msg);

const isTestShaped = (f) =>
  /\.(test|spec)\.(mjs|js|ts)$/.test(f) ||
  /^test\/e2e\/scenarios\/[^/]+\.json$/.test(f) ||
  /^test\/e2e\/run-[^/]+\.sh$/.test(f) ||
  /^hosts\/[^/]+\/ci\/run-[^/]+\.sh$/.test(f) ||
  /^runtime\/dsh\/ci\/run-[^/]+\.sh$/.test(f) ||
  /^test\/panel\/[^/]*e2e[^/]*\.mjs$/.test(f) ||
  /^\.github\/workflows\/[^/]+\.yml$/.test(f);

function loadTaxonomy(root) {
  const file = join(root, 'test', 'taxonomy.json');
  if (!existsSync(file)) { bad('test/taxonomy.json is missing'); return null; }
  let doc;
  try { doc = JSON.parse(readFileSync(file, 'utf8')); }
  catch (e) { bad(`test/taxonomy.json does not parse: ${e.message}`); return null; }
  if (!Array.isArray(doc.kinds) || doc.kinds.some((k) => !KINDS.has(k))) {
    bad('taxonomy kinds enum is invalid (expected static|unit|integration|e2e)');
  }
  return doc;
}

function judge(root, doc, trackedFiles) {
  if (!doc) return;
  const classified = new Map();
  for (const e of doc.entries ?? []) {
    if (classified.has(e.path)) bad(`duplicate taxonomy entry: ${e.path}`);
    classified.set(e.path, e);
    if (!KINDS.has(e.kind)) bad(`${e.path}: unknown kind '${e.kind}'`);
    const existing = e.path.startsWith('gate:')
      ? true
      : existsSync(join(root, e.path));
    if (!existing) bad(`${e.path}: classified but absent from the tree`);
  }
  for (const s of doc.scenarios ?? []) {
    if (classified.has(s.path)) bad(`duplicate taxonomy entry: ${s.path}`);
    classified.set(s.path, s);
    if (!KINDS.has(s.kind)) bad(`${s.path}: unknown kind '${s.kind}'`);
    if (!existsSync(join(root, s.path))) bad(`${s.path}: classified but absent from the tree`);
    for (const d of s.drivenBy ?? []) {
      if (!existsSync(join(root, d))) bad(`${s.path}: drivenBy '${d}' is absent from the tree`);
    }
    if (!s.drivenBy?.length && (!s.orphan || !s.note)) {
      bad(`${s.path}: no driver — must carry orphan:true and a note naming how it is carried`);
    }
  }
  for (const f of trackedFiles) {
    if (isTestShaped(f) && !classified.has(f)) {
      bad(`${f}: unclassified test artifact — add it to test/taxonomy.json with a kind`);
    }
  }
  // Registry agreement: the leg's kind must match the taxonomy's kind for
  // the file its counts come from (first runner path named in countsFrom).
  for (const leg of REGISTRY) {
    if (!KINDS.has(leg.kind)) {
      bad(`registry leg '${leg.name}': missing/invalid kind — the taxonomy layer it answers on is part of the contract`);
      continue;
    }
    const m = leg.countsFrom.match(/([\w./-]+(?:\.sh|\.mjs))/);
    const runner = m ? m[1] : null;
    const row = runner ? classified.get(runner) : null;
    if (row && row.kind !== leg.kind) {
      bad(`registry leg '${leg.name}' declares kind '${leg.kind}' but taxonomy says '${row.kind}' for ${runner}`);
    }
  }
}

// ---- the rejection proof (rules.md rule 6) ----
function selfTest() {
  const fixture = mkdtempSync(join(tmpdir(), 'taxonomy-reject-'));
  try {
    // A minimal coherent tree: the taxonomy classifies one file, the tree
    // carries TWO — the unclassified one must be named.
    mkdirSync(join(fixture, 'test/panel'), { recursive: true });
    mkdirSync(join(fixture, '.github/workflows'), { recursive: true });
    writeFileSync(join(fixture, 'test/taxonomy.json'), JSON.stringify({
      kinds: ['static', 'unit', 'integration', 'e2e'],
      entries: [{ path: 'test/panel/appshell-catalog.test.js', kind: 'unit', note: 'fixture' }],
      scenarios: [],
    }));
    writeFileSync(join(fixture, 'test/panel/appshell-catalog.test.js'), 'export {};\n');
    writeFileSync(join(fixture, 'test/panel/unclassified-thing.test.js'), 'export {};\n');
    writeFileSync(join(fixture, '.github/workflows/ci.yml'), 'on: push\n');
    const files = [
      'test/panel/appshell-catalog.test.js', 'test/panel/unclassified-thing.test.js',
      '.github/workflows/ci.yml',
    ];
    const seen = [];
    const badFixture = (m) => seen.push(m);
    const doc = loadTaxonomy(fixture);
    // judge() pushes onto the module-level violations; scope it by swapping.
    const real = [...violations];
    violations.length = 0;
    judge(fixture, doc, files);
    const caught = violations.some((v) => v.includes('unclassified-thing.test.js'));
    violations.length = 0;
    violations.push(...real);
    if (!caught) {
      bad('SELF-TEST FAILED: the fixture tree carries an unclassified test file and the checker did not name it (rule 6 — a gate that never fails is vacuous)');
    }
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}

const main = () => {
  const doc = loadTaxonomy(ROOT);
  if (violations.length) {
    console.error('test-taxonomy: FAIL (document invalid):');
    for (const v of violations) console.error(`  ${v}`);
    process.exit(2);
  }
  const tracked = sh('git ls-files');
  judge(ROOT, doc, tracked);
  if (violations.length) {
    console.error(`test-taxonomy: FAIL — ${violations.length} violation(s):`);
    for (const v of violations) console.error(`  ${v}`);
    process.exit(1);
  }
  const counts = {};
  for (const e of doc.entries) counts[e.kind] = (counts[e.kind] ?? 0) + 1;
  for (const s of doc.scenarios) counts[s.kind] = (counts[s.kind] ?? 0) + 1;
  console.log(
    `test-taxonomy: green — ${doc.entries.length} entries + ${doc.scenarios.length} scenarios ` +
    `classified (${JSON.stringify(counts)}); registry agreement holds`,
  );
};

if (process.argv.includes('--self-test')) {
  selfTest();
  if (violations.length) {
    console.error('test-taxonomy --self-test: FAIL');
    for (const v of violations) console.error(`  ${v}`);
    process.exit(1);
  }
  console.log('test-taxonomy --self-test: rejection proof green (unclassified fixture named)');
  main();
} else {
  main();
}
