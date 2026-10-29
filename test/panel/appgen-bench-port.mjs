/**
 * appgen-bench-port: the ported WebGen-Bench accuracy benchmark. The
 * corpus (test/panel/appgen-bench/webgen-port.json, built by
 * appgen-bench/build-port.mjs) keeps the upstream test cases VERBATIM;
 * the port swaps the artifact under test (def-native mobile-app prompt →
 * app-shell spec) and the execution tier — v1 grades each case by
 * INSPECTING the generated spec with a different-family judge (no browser
 * GUI agent yet; the action-execution leg upgrades this to real
 * dispatch). Scoring is the upstream formula, verbatim:
 *
 *   accuracy = (N_yes + 0.5 × N_partial) / N_total × 100%
 *
 * at the TEST-CASE level (YES=1, PARTIAL=0.5), plus the upstream
 * diagnostics: start-failed rate (generation produced no valid spec — its
 * cases all score NO) and a judge-failure rate (unscorable cases excluded
 * from the denominator, the WebCoderBench exclusion rule).
 *
 * Generator: LLM_BASE_URL/LLM_API_KEY/LLM_MODEL (fallback DSH_LLM_*, then
 * ZAI_*). Judge: JUDGE_* (fallback ZAI_*) — keep it a DIFFERENT family
 * from the generator (no self-preference). Knobs: BENCH_N (first N
 * instructions), LEDGER_STEM. Not a CI gate — the loop's percentage
 * benchmark (doc/appgen-auto-research.md).
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { validate } from '../../system-plugins/dsh-appshell/lib/validate.js';
import { SYSTEM_V1, SYSTEM_V2 } from './appgen-eval/system-prompt.js';

const env = Object.fromEntries(
  readFileSync(new URL('../../.env', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const GEN = {
  baseURL: process.env.LLM_BASE_URL || env.DSH_LLM_BASE_URL || env.ZAI_BASE_URL,
  apiKey: process.env.LLM_API_KEY || env.DSH_LLM_API_KEY || env.ZAI_API_KEY,
  model: process.env.LLM_MODEL || 'deepseek-v4-flash',
};
const JUDGE = {
  baseURL: process.env.JUDGE_BASE_URL || env.ZAI_BASE_URL,
  apiKey: process.env.JUDGE_API_KEY || env.ZAI_API_KEY,
  model: process.env.JUDGE_MODEL || env.ZAI_MODEL || 'glm-4.6',
};
const LEDGER_STEM = process.env.LEDGER_STEM || 'webgen-port';
const BENCH_N = Number(process.env.BENCH_N || 0);
// Runs per instruction. 1 = the upstream one-shot shape; >1 averages away
// the ±2-4 point pass-to-pass generation noise (iteration-4 finding) —
// deltas below the noise floor are not claims.
const BENCH_RUNS = Math.max(1, Number(process.env.BENCH_RUNS || 1));
for (const [k, v] of Object.entries({ gen: GEN, judge: JUDGE })) {
  if (!v.apiKey || !v.baseURL) { console.error(`appgen-bench-port: missing ${k} endpoint credentials`); process.exit(1); }
}

const PORT_VERSION = JSON.parse(
  readFileSync(new URL('./appgen-bench/webgen-port.json', import.meta.url), 'utf8')
).port_version;
const corpus = JSON.parse(
  readFileSync(new URL('./appgen-bench/webgen-port.json', import.meta.url), 'utf8')
).instructions;
const selected = BENCH_N > 0 ? corpus.slice(0, BENCH_N) : corpus;

const VERDICTS = new Set(['YES', 'PARTIAL', 'NO']);
const call = (which, messages, temperature) => fetch(`${which.baseURL}/chat/completions`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${which.apiKey}` },
  body: JSON.stringify({ model: which.model, messages, temperature }),
});

async function generate(prompt) {
  const res = await call(GEN, [
    { role: 'system', content: process.env.APPGEN_SYSTEM === 'V1' ? SYSTEM_V1 : SYSTEM_V2 },
    { role: 'user', content: prompt },
  ], 0.7);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text().then((t) => t.slice(0, 200))}`);
  const body = await res.json();
  return { content: body.choices?.[0]?.message?.content ?? '', tokens: body.usage?.total_tokens ?? 0 };
}

function extractSpec(text) {
  const cleaned = text.replace(/```json?\n?/g, '').replace(/```\n?/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}') + 1;
  if (start === -1 || end === 0) throw new Error('no JSON object found');
  return JSON.parse(cleaned.slice(start, end));
}

const JUDGE_SYSTEM = `You grade test cases against an app-shell spec — a declarative description of ONE mobile app screen. The spec is the complete product surface being graded; there are no hidden pages.

Vocabulary: the screen is a component tree; "tabs" (2-5 labels) switch top-level sections of the screen; "actions" are the declared interactive capabilities (every button's action id appears there); templates include search-bar, tab-bar, chat-row, service-grid, banner-card, hcard-row (horizontal cover cards), balance-card, mini-player, progressbar.

For each test case, decide whether the EXPECTED RESULT is achievable by a user operating THIS screen as specified:
- YES: the spec fully provides what the case needs — the content/structure is present AND an action or interactive element delivers the operation.
- PARTIAL: part of what the case needs is present (related content exists but the specific operation has no action; or the action exists but the content behind it is absent).
- NO: the spec provides nothing that would deliver the expected result.

Grade only from the spec; do not invent capabilities beyond it. Reply ONLY a JSON array — one object per case, in the case order given: [{"i":<case index>,"v":"YES"|"PARTIAL"|"NO","why":"<=16 words"}]`;

async function judgeCases(instruction, cases, spec) {
  const user = `Original requirement (context):\n${instruction.instruction_en}\n\nTest cases:\n${JSON.stringify(
    cases.map((c, i) => ({ i, task: c.task, expected_result: c.expected_result })), null, 1
  )}\n\nGenerated app-shell spec to grade:\n${JSON.stringify(spec)}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await call(JUDGE, [
      { role: 'system', content: JUDGE_SYSTEM },
      { role: 'user', content: user },
    ], 0);
    if (!res.ok) continue;
    const body = await res.json();
    const text = body.choices?.[0]?.message?.content ?? '';
    const start = text.indexOf('[');
    const end = text.lastIndexOf(']') + 1;
    if (start === -1 || end === 0) continue;
    let parsed;
    try { parsed = JSON.parse(text.slice(start, end)); } catch { continue; }
    if (!Array.isArray(parsed)) continue;
    const byIndex = new Map(parsed.filter((v) => VERDICTS.has(v.v)).map((v) => [v.i, v]));
    if (cases.every((_, i) => byIndex.has(i))) return cases.map((_, i) => byIndex.get(i));
  }
  return null;
}

const rows = [];
for (let run = 1; run <= BENCH_RUNS; run++) {
for (const instruction of selected) {
  const row = { source_id: instruction.source_id, application_type: instruction.application_type, cases: instruction.cases.length, run };
  try {
    const gen = await generate(instruction.prompt);
    row.gen_tokens = gen.tokens;
    let spec = null;
    let renderCheck = { ok: false, errors: [{ code: 'UNPARSEABLE', msg: 'generation was not a JSON object' }] };
    try {
      spec = extractSpec(gen.content);
      renderCheck = validate(spec);
    } catch (e) {
      renderCheck = { ok: false, errors: [{ code: 'UNPARSEABLE', msg: e.message.slice(0, 120) }] };
    }
    const checked = renderCheck;
    row.structuralOk = checked.ok;
    if (!checked.ok) {
      row.renderError = checked.errors?.[0]?.msg?.slice(0, 160);
      // Start Failed (the upstream diagnostic): no usable artifact — every
      // case scores NO, the harshest honest reading.
      row.start_failed = true;
      row.verdicts = instruction.cases.map((c) => ({ task_category: c.task_category, v: 'NO', why: 'start failed: no valid spec' }));
    } else {
      const judged = await judgeCases(instruction, instruction.cases, spec);
      if (judged === null) {
        row.judge_failed = true;
        row.verdicts = [];
      } else {
        row.verdicts = judged.map((v, i) => ({ task_category: instruction.cases[i].task_category, v: v.v, why: v.why }));
      }
    }
  } catch (e) {
    row.error = e.message.slice(0, 160);
    row.start_failed = true;
    row.verdicts = instruction.cases.map((c) => ({ task_category: c.task_category, v: 'NO', why: 'start failed: ' + row.error }));
  }
  const scored = row.verdicts.filter((v) => VERDICTS.has(v.v));
  row.scored = scored.length;
  row.yes = scored.filter((v) => v.v === 'YES').length;
  row.partial = scored.filter((v) => v.v === 'PARTIAL').length;
  row.no = scored.filter((v) => v.v === 'NO').length;
  row.accuracy = scored.length ? Math.round((row.yes + 0.5 * row.partial) / scored.length * 1000) / 10 : null;
  rows.push(row);
  console.log(`${instruction.source_id}#${run}: structural ${row.structuralOk ? 'OK' : 'START-FAIL'} | Y ${row.yes} P ${row.partial} N ${row.no}${row.scored < row.cases ? ` (excluded ${row.cases - row.scored})` : ''} → accuracy ${row.accuracy === null ? 'n/a' : row.accuracy + '%'}`);
}
}

// ---- aggregate: the upstream formula at case level -------------------------
const all = rows.flatMap((r) => r.verdicts).filter((v) => VERDICTS.has(v.v));
const acc = (verdicts) => {
  const yes = verdicts.filter((v) => v.v === 'YES').length;
  const partial = verdicts.filter((v) => v.v === 'PARTIAL').length;
  return { yes, partial, no: verdicts.length - yes - partial, accuracy: verdicts.length ? Math.round((yes + 0.5 * partial) / verdicts.length * 1000) / 10 : null };
};
const overall = acc(all);
const byCategory = {};
for (const v of all) {
  const k = v.task_category.primary_category;
  (byCategory[k] ??= []).push(v);
}
const categories = Object.fromEntries(Object.entries(byCategory).map(([k, vs]) => [k, acc(vs)]));
// Mean of per-instruction accuracies across runs (the noise-averaged
// headline; pooling all cases would let multi-case instructions dominate).
const perInstruction = {};
for (const r of rows) {
  if (r.accuracy !== null) (perInstruction[r.source_id] ??= []).push(r.accuracy);
}
const meanAccuracy = Object.values(perInstruction).length
  ? Math.round(Object.values(perInstruction).reduce((sum, arr) => sum + arr.reduce((a, b) => a + b, 0) / arr.length, 0) / Object.values(perInstruction).length * 10) / 10
  : null;
const totalCases = rows.reduce((n, r) => n + r.cases, 0);
const startFailed = rows.filter((r) => r.start_failed).length;
const judgeFailed = rows.filter((r) => r.judge_failed).length;

console.log(`\n--- WebGen-Bench port (${GEN.model} gen × ${JUDGE.model} judge, ${rows.length} instructions / ${totalCases} cases) ---`);
console.log(`ACCURACY (pooled): ${overall.accuracy}%  (YES ${overall.yes} / PARTIAL ${overall.partial} / NO ${overall.no} of ${all.length} scored)`);
if (BENCH_RUNS > 1) console.log(`ACCURACY (mean of per-instruction means, ${BENCH_RUNS} runs): ${meanAccuracy}%`);
for (const [k, v] of Object.entries(categories)) console.log(`  ${k.padEnd(28)} ${v.accuracy}%  (Y ${v.yes} P ${v.partial} N ${v.no})`);
console.log(`start-failed: ${startFailed}/${rows.length} instructions; judge-failed: ${judgeFailed}/${rows.length}; excluded cases: ${totalCases - all.length}`);

const ledger = {
  meta: {
    at: new Date().toISOString(), generator: GEN.model, judge: JUDGE.model,
    portVersion: PORT_VERSION, systemPrompt: process.env.APPGEN_SYSTEM === 'V1' ? 'SYSTEM_V1' : 'SYSTEM_V2', formula: 'accuracy = (N_yes + 0.5*N_partial) / N_total * 100 (WebGen-Bench, case level)',
    tier: 'static (spec-inspection judge; action-execution leg upgrades to real dispatch)',
    instructions: rows.length, cases: totalCases,
  },
  overall, meanAccuracy, runsPerInstruction: BENCH_RUNS, categories,
  diagnostics: { startFailedInstructions: startFailed, judgeFailedInstructions: judgeFailed, excludedCases: totalCases - all.length },
  rows,
};
const outDir = new URL('../../tools/dev-web-carrier/artifacts/appgen-bench/', import.meta.url);
mkdirSync(outDir, { recursive: true });
const outPath = new URL(`../../tools/dev-web-carrier/artifacts/appgen-bench/${LEDGER_STEM}.json`, import.meta.url);
writeFileSync(outPath, JSON.stringify(ledger, null, 2) + '\n');
console.log(`ledger → ${outPath.pathname}`);
