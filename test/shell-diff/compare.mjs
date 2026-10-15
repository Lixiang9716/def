// dsh:logging-exempt (node-side checker: the report + divergence list are the product)
/**
 * compare.mjs — the shell-diff harness's assertion + reporting face
 * (test-hardening row 6). Consumes the two symmetric JSONL files (the dsh
 * driver's and run-bash's), normalizes them, applies each case's `kind`
 * from cases.json, and writes:
 *
 *   report.json     — every case: normalized both sides, the verdict,
 *                     and the case's note. The machine-readable receipt.
 *   divergences.md  — the DIFFERENCE LIST (差异清单): every non-'match'
 *                     verdict in one human-readable document, grouped into
 *                     contract-documented divergences vs open findings.
 *
 * Normalization (the only transformations applied):
 *   - every occurrence of the bash sandbox root is replaced by '' (both
 *     sides), so bash's absolute scratch paths read as the same
 *     workspace-relative spellings the dsh side prints;
 *   - every occurrence of the dsh workspace root likewise (defensive: the
 *     executor is workspace-relative by design, a leak would be a finding);
 *   - CRLF → LF (cheap; neither seat emits it today).
 * Nothing else is smoothed: whitespace, ordering, and trailing bytes are
 * compared exactly.
 *
 * Verdicts:
 *   match               kind 'match': exit + stdout + stderr equal
 *                       (stderrFree: exit + stdout equal AND stderr is
 *                       silent on BOTH sides or loud on BOTH sides — the
 *                       dialect contract promises exit codes and stdout,
 *                       not GNU error TEXT; a silence asymmetry would be a
 *                       real finding and fails here).
 *   refusal-ok          kind 'refusal': dsh exit == case.exit, dsh stdout
 *                       empty, every needle present in dsh stderr; the bash
 *                       side is recorded as differential context.
 *   divergence-pinned   kind 'divergence': dsh == expectDsh AND bash != dsh
 *                       — the known difference still exists, still in the
 *                       pinned shape. A fix (bash == dsh) or drift (dsh !=
 *                       pin) trips the case and forces re-triage.
 *   Anything else is a FAIL: an unexpected difference is a bug against the
 *   dialect contract, and this checker exits 1 naming it.
 *
 * usage: node compare.mjs --dsh <dsh.jsonl> --bash <bash.jsonl> \
 *          --sandbox <bash sandbox root> --dsh-root <dsh workspace root> \
 *          --out <report dir>
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

/** The case matrix — DATA only, shared verbatim with both runners. */
const CASES = JSON.parse(readFileSync(new URL('cases.json', import.meta.url), 'utf8')).cases;

const args = process.argv.slice(2);
const opt = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
const dshPath = resolve(opt('--dsh') ?? die('usage: compare.mjs --dsh f --bash f --sandbox dir --dsh-root dir --out dir'));
const bashPath = resolve(opt('--bash') ?? die('usage: compare.mjs --dsh f --bash f --sandbox dir --dsh-root dir --out dir'));
const sandbox = resolve(opt('--sandbox') ?? die('usage: compare.mjs --dsh f --bash f --sandbox dir --dsh-root dir --out dir'));
const dshRoot = resolve(opt('--dsh-root') ?? die('usage: compare.mjs --dsh f --bash f --sandbox dir --dsh-root dir --out dir'));
const outDir = resolve(opt('--out') ?? die('usage: compare.mjs --dsh f --bash f --sandbox dir --dsh-root dir --out dir'));

function die(message) {
  console.error(`compare: ${message}`);
  process.exit(2);
}

const readJsonl = (path, seat) => {
  let rows;
  try {
    rows = readFileSync(path, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  } catch (error) {
    die(`cannot read the ${seat} results (${path}): ${error.message}`);
  }
  return new Map(rows.map((row) => [row.id, row]));
};

const dsh = readJsonl(dshPath, 'dsh');
const bash = readJsonl(bashPath, 'bash');

/** The only normalization: scratch-root scrubbing + CRLF. */
const normalize = (text) => String(text)
  .replaceAll(sandbox, '')
  .replaceAll(`${dshRoot}/`, '')
  .replaceAll(dshRoot, '')
  .replaceAll('\r\n', '\n');
const normSide = (side) => ({
  exitCode: side.exitCode,
  stdout: normalize(side.stdout),
  stderr: normalize(side.stderr),
});

/** The assertion per kind — see the header. Returns {verdict, detail}. */
const judge = (one, dn, bn) => {
  const sameExit = dn.exitCode === bn.exitCode;
  const sameStdout = dn.stdout === bn.stdout;
  const sameStderr = dn.stderr === bn.stderr;
  const bothSilent = dn.stderr === '' && bn.stderr === '';
  const bothLoud = dn.stderr !== '' && bn.stderr !== '';
  if (one.kind === 'match') {
    if (one.stderrFree === true) {
      if (sameExit && sameStdout && (bothSilent || bothLoud)) {
        return { verdict: 'match', detail: `exit ${dn.exitCode} + stdout agree; stderr loud on both sides (text differs, wording not contract)` };
      }
      return {
        verdict: 'BUG',
        detail: `exit dsh=${dn.exitCode} bash=${bn.exitCode}, stdout ${sameStdout ? 'agrees' : 'DIFFERS'}, stderr silence asymmetry (dsh ${dn.stderr === '' ? 'silent' : 'loud'}, bash ${bn.stderr === '' ? 'silent' : 'loud'})`,
      };
    }
    if (sameExit && sameStdout && sameStderr) return { verdict: 'match', detail: 'exit + stdout + stderr identical after normalization' };
    return {
      verdict: 'BUG',
      detail: `exit dsh=${dn.exitCode} bash=${bn.exitCode}; stdout ${sameStdout ? 'agrees' : 'DIFFERS'}; stderr ${sameStderr ? 'agrees' : 'DIFFERS'}`,
    };
  }
  if (one.kind === 'refusal') {
    const needles = one.needles ?? [];
    const missing = needles.filter((needle) => !dn.stderr.includes(needle));
    if (dn.exitCode === one.exit && dn.stdout === '' && missing.length === 0) {
      return { verdict: 'refusal-ok', detail: `dsh refuses exit ${dn.exitCode} naming what is missing (needles: ${needles.length}); bash context: exit ${bn.exitCode}` };
    }
    return {
      verdict: 'BUG',
      detail: `refusal shape broken: exit ${dn.exitCode} (want ${one.exit}), stdout ${dn.stdout === '' ? 'empty' : 'NON-EMPTY'}, needles missing: [${missing.join('; ')}]`,
    };
  }
  if (one.kind === 'divergence') {
    const pinned = dn.exitCode === one.expectDsh.exitCode && dn.stdout === one.expectDsh.stdout;
    const differs = !sameExit || !sameStdout || !sameStderr;
    if (pinned && differs) {
      return { verdict: 'divergence-pinned', detail: `the known difference is present, in the pinned dsh shape (exit ${dn.exitCode}); bash: exit ${bn.exitCode}` };
    }
    if (!differs) {
      return { verdict: 'CHANGED', detail: 'the seats now AGREE — the pinned divergence is gone: promote this case to kind match' };
    }
    return { verdict: 'CHANGED', detail: `dsh drifted off the pin (exit ${dn.exitCode}, want ${one.expectDsh.exitCode}): re-triage the divergence` };
  }
  return { verdict: 'BUG', detail: `unknown kind '${one.kind}'` };
};

const cases = CASES.map((one) => {
  const d = dsh.get(one.id);
  const b = bash.get(one.id);
  if (d === undefined || b === undefined) {
    return { id: one.id, family: one.family, kind: one.kind, note: one.note, verdict: 'MISSING', detail: `no ${d === undefined ? 'dsh' : 'bash'} result for the case`, dsh: null, bash: null };
  }
  const dn = normSide(d);
  const bn = normSide(b);
  const judgment = judge(one, dn, bn);
  return {
    id: one.id,
    family: one.family,
    kind: one.kind,
    note: one.note,
    verdict: judgment.verdict,
    detail: judgment.detail,
    // Normalized only: report.json is a COMMITTED receipt (runtime/dsh/
    // artifacts/shell-diff/) and must stay free of scratch paths. The raw
    // bytes live in the two JSONL files under gitignored tmp/.
    dsh: dn,
    bash: bn,
  };
});

const idSet = new Set(CASES.map((one) => one.id));
for (const seat of [dsh, bash]) {
  for (const id of seat.keys()) {
    if (!idSet.has(id)) die(`results carry an id the case matrix does not define: ${id}`);
  }
}

const passed = cases.filter((one) => ['match', 'refusal-ok', 'divergence-pinned'].includes(one.verdict));
const failed = cases.filter((one) => !['match', 'refusal-ok', 'divergence-pinned'].includes(one.verdict));
const divergent = cases.filter((one) => one.verdict === 'divergence-pinned');
const documented = divergent.filter((one) => (one.note ?? '').startsWith('documented'));
const openFindings = divergent.filter((one) => !(one.note ?? '').startsWith('documented'));

mkdirSync(outDir, { recursive: true });
const report = {
  generatedBy: 'test/shell-diff/compare.mjs (test-hardening row 6)',
  cases: cases.length,
  verdicts: {
    match: cases.filter((one) => one.verdict === 'match').length,
    'refusal-ok': cases.filter((one) => one.verdict === 'refusal-ok').length,
    'divergence-pinned': divergent.length,
    '...of which contract-documented': documented.length,
    '...of which open findings': openFindings.length,
    BUG: failed.filter((one) => one.verdict === 'BUG').length,
    CHANGED: failed.filter((one) => one.verdict === 'CHANGED').length,
    MISSING: failed.filter((one) => one.verdict === 'MISSING').length,
  },
  normalization: {
    // Basenames only — report.json is a committed receipt, no scratch paths.
    bashSandbox: basename(sandbox),
    dshWorkspace: basename(dshRoot),
    rule: 'scratch roots scrubbed to workspace-relative; CRLF folded; nothing else smoothed',
  },
  cases,
};
writeFileSync(join(outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');

const quote = (text) => (text === '' ? '(empty)' : String(text).replaceAll('\n', '\\n'));
const divergenceSection = (one) => {
  const caseData = CASES.find((c) => c.id === one.id);
  const row = (seat, label) => (seat === null
    ? `| ${label} | — | (no result) | (no result) |\n`
    : `| ${label} | ${seat.exitCode} | \`${quote(seat.stdout)}\` | \`${quote(seat.stderr)}\` |\n`);
  return `### ${one.id} — ${one.family}\n\n`
    + `- ${one.note ?? '(no classification note)'}\n`
    + `- ${one.detail}\n\n`
    + '```sh\n'
    + `${caseData?.script ?? '(case not in matrix)'}\n`
    + '```\n\n'
    + `| | exit | stdout | stderr |\n|---|---|---|---|\n`
    + row(one.dsh, 'dsh (dsh-shell-js)')
    + row(one.bash, 'bash (reference)')
    + '\n';
};

const md = [
  '# shell-diff divergence list (差异清单)', '',
  'One row per case whose two seats did not agree byte-for-byte after'
  + ' normalization — test-hardening row 6, generated by'
  + ' test/shell-diff/compare.mjs over cases.json. "documented" means the'
  + ' dialect contract discloses the difference (the refusal vocabulary'
  + ' or a §6 dialect note); "OPEN FINDING" means the difference is real,'
  + ' undisclosed, and pinned here until fixed or promoted.', '',
  `## Summary: ${cases.length} cases — ${passed.length} pass (${divergent.length} pinned divergences: ${documented.length} documented, ${openFindings.length} open), ${failed.length} fail`, '',
  ...(openFindings.length > 0
    ? ['## OPEN FINDINGS (undisclosed differences — real bugs against the reference)', '', ...openFindings.map(divergenceSection)]
    : ['## OPEN FINDINGS', '', '(none this run)', '']),
  ...(documented.length > 0
    ? ['## Documented divergences (the contract refuses or discloses these)', '', ...documented.map(divergenceSection)]
    : ['## Documented divergences', '', '(none this run)', '']),
  ...(failed.length > 0
    ? ['## FAILING CASES (unexpected differences — these fail the leg)', '', ...failed.map(divergenceSection)]
    : ['## FAILING CASES', '', '(none this run)', '']),
];
writeFileSync(join(outDir, 'divergences.md'), md.join('\n'), 'utf8');

console.error(`compare: ${cases.length} cases — ${passed.length} pass, ${failed.length} fail`
  + ` (pinned divergences: ${divergent.length}, of which ${openFindings.length} open findings)`);
if (failed.length > 0) {
  for (const one of failed) console.error(`compare: FAIL ${one.id}: ${one.detail}`);
  process.exit(1);
}
