/**
 * appgen-eval: the breadth layer over the L3/M4 anchors. The L3 benchmark
 * measures ONE prompt deeply (10 runs, structural gates); this runner
 * measures MANY prompts shallowly — N categories × M runs of real-model
 * generation, each judged by the four-gate validator (structural) AND the
 * machine-checkable half of the design constitution (the rubric), with
 * every failure classified into the census ledger the auto-research loop
 * triages (doc/appgen-auto-research.md).
 *
 * Provider-neutral like the M4 ledger: LLM_BASE_URL/LLM_API_KEY/LLM_MODEL
 * process-env overrides, ZAI_* the GLM default. The prompt set lives in
 * appgen-eval/prompts.json; the generation prompt is versioned in
 * appgen-eval/system-prompt.js (frozen exports — never edit a version).
 *
 * Knobs: APPGEN_RUNS (per category, default 2), APPGEN_CATEGORIES (comma
 * list, default all), LEDGER_STEM (default 'appgen-census'). Not a CI
 * gate — a family-change rerun per plan §3.5, driven by the loop.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { validate } from '../../system-plugins/dsh-appshell/lib/validate.js';
import { specToA2UI } from '../../system-plugins/dsh-appshell/lib/appshell-to-a2ui.js';
import { SYSTEM_V1 } from './appgen-eval/system-prompt.js';

const env = Object.fromEntries(
  readFileSync(new URL('../../.env', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const BASE_URL = process.env.LLM_BASE_URL || env.ZAI_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4';
const API_KEY = process.env.LLM_API_KEY || env.ZAI_API_KEY;
const MODEL = process.env.LLM_MODEL || env.ZAI_MODEL || 'glm-4.6';
const LEDGER_STEM = process.env.LEDGER_STEM || 'appgen-census';
const RUNS = Number(process.env.APPGEN_RUNS || 2);
const ONLY = (process.env.APPGEN_CATEGORIES || '').split(',').map((s) => s.trim()).filter(Boolean);

if (!API_KEY) { console.error('appgen-eval: no API key in env — cannot run the census'); process.exit(1); }

const { version: PROMPTSET_VERSION, categories } = JSON.parse(
  readFileSync(new URL('./appgen-eval/prompts.json', import.meta.url), 'utf8')
);
const selected = ONLY.length ? categories.filter((c) => ONLY.includes(c.id)) : categories;
if (!selected.length) { console.error(`appgen-eval: no categories matched ${process.env.APPGEN_CATEGORIES}`); process.exit(1); }

// ---- the rubric: the machine-checkable half of the design constitution ----
// Templates keep their names in the raw spec (validate()'s expanded tree
// erases them into primitives), so every visual rule reads the RAW tree.
const CONTAINERS = new Set(['row', 'column', 'card']);
const MOBILE_TEMPLATES = new Set(['search-bar', 'tab-bar', 'mini-player', 'chat-row', 'service-grid', 'hcard-row']);
const HERO_TYPES = new Set(['banner-card', 'hcard-row', 'balance-card']);
const EMOJI_RE = /\p{Extended_Pictographic}/gu;
const PLACEHOLDER_RE = /待定|示例|占位|lorem|placeholder|测试文本|TODO|XXX/i;
const TEXT_FIELDS = ['text', 'label', 'sub', 'title', 'subtitle', 'name', 'preview', 'placeholder'];

const walk = (node, fn, depth = 0) => {
  if (!node || typeof node !== 'object') return;
  fn(node, depth);
  for (const child of node.children ?? []) walk(child, fn, depth + 1);
};

/** Collect the raw-tree facts the constitution rules judge. */
function rubricFacts(spec) {
  const screen = spec.screen ?? {};
  const nodes = [];
  walk(screen, (n, depth) => nodes.push({ n, depth }));
  const textOf = (n) => TEXT_FIELDS.filter((k) => typeof n[k] === 'string').map((k) => n[k]);
  return {
    top: screen.children ?? [],
    nodes,
    textOf,
    templateTypes: new Set(nodes.map(({ n }) => n.type).filter((t) => MOBILE_TEMPLATES.has(t) || t === 'balance-card' || t === 'banner-card')),
    titles: nodes.filter(({ n }) => n.type === 'text' && n.size === 'title'),
    emojiCount: nodes.reduce((sum, { n }) => {
      let c = (typeof n.emoji === 'string' && n.emoji) ? 1 : 0;
      for (const t of textOf(n)) c += (t.match(EMOJI_RE) ?? []).length;
      return sum + c;
    }, 0),
    interactive: nodes.filter(({ n }) =>
      n.type === 'button' || (n.type === 'balance-card' && n.action) || (n.type === 'mini-player' && n.action)),
    tabLabels: [
      ...(Array.isArray(spec.tabs) ? spec.tabs : []),
      ...nodes.filter(({ n }) => n.type === 'tab-bar').flatMap(({ n }) => (n.tabs ?? []).map((t) => t.label ?? '')),
    ],
    actions: spec.actions ?? [],
  };
}

function rubric(spec) {
  const f = rubricFacts(spec);
  const fails = [];
  const push = (code, msg) => fails.push({ code, msg });

  if (!HERO_TYPES.has(f.top[0]?.type)) push('RUBRIC_HERO_FIRST', `screen.children[0] is ${f.top[0]?.type ?? 'missing'}`);
  if (f.top.length < 4 || f.top.length > 6) push('RUBRIC_TOP_BLOCKS', `top-level blocks = ${f.top.length} (want 4-6)`);
  const maxDepth = Math.max(0, ...f.nodes.map(({ depth }) => depth));
  if (maxDepth > 3) push('RUBRIC_DEPTH', `nesting depth ${maxDepth} > 3`);
  if (f.titles.length > 3) push('RUBRIC_TITLE_BUDGET', `${f.titles.length} title runs > 3`);
  for (const { n } of f.titles) {
    if ([...n.text].length > 10) { push('RUBRIC_TITLE_LEN', `title >10 runes: "${n.text.slice(0, 16)}"`); break; }
  }
  if (f.emojiCount > 4) push('RUBRIC_EMOJI_BUDGET', `${f.emojiCount} emoji > 4`);
  const longTab = f.tabLabels.find((t) => [...t].length > 4);
  if (longTab) push('RUBRIC_TAB_LEN', `tab label >4 runes: "${longTab}"`);
  if (f.templateTypes.size < 2) push('RUBRIC_TEMPLATES', `mobile templates = ${f.templateTypes.size} (want ≥2): ${[...f.templateTypes].join(',')}`);
  const placeholderHit = f.nodes.flatMap(({ n }) => f.textOf(n)).find((t) => PLACEHOLDER_RE.test(t));
  if (placeholderHit) push('RUBRIC_PLACEHOLDER', `placeholder copy: "${placeholderHit.slice(0, 16)}"`);
  for (const { n } of f.nodes.filter(({ n }) => n.type === 'hcard-row')) {
    const colors = (n.items ?? []).map((i) => i.cover?.color).filter(Boolean);
    if ((n.items ?? []).length >= 3 && new Set(colors).size < 3) {
      push('RUBRIC_COVER_PALETTE', `hcard-row covers reuse colors: ${colors.join(',')}`);
      break;
    }
  }
  if (f.actions.length === 0) push('RUBRIC_NO_ACTIONS', 'actions[] empty — a poster, not an app');

  return {
    fails,
    counts: {
      topBlocks: f.top.length, maxDepth, titles: f.titles.length, emoji: f.emojiCount,
      templates: [...f.templateTypes], actions: f.actions.length, interactive: f.interactive.length,
    },
  };
}

function expectations(spec, wants) {
  const templateTypes = new Set();
  walk(spec.screen ?? {}, (n) => templateTypes.add(n.type));
  return wants.map((w) => ({
    ...w,
    hit: w.kind === 'template' ? templateTypes.has(w.id) : (spec.actions ?? []).length >= w.count,
  }));
}

// ---- the model leg ---------------------------------------------------------
async function callModel(messages) {
  const start = Date.now();
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_KEY}` },
    body: JSON.stringify({ model: MODEL, messages, temperature: 0.7 }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text().then((t) => t.slice(0, 200))}`);
  const body = await res.json();
  // Sampled AFTER the body settles — the m4 ledger's documented trap: DeepSeek
  // sends headers ~100ms early while the JSON streams chunked (a 30× lie).
  const latency = Date.now() - start;
  return {
    content: body.choices?.[0]?.message?.content ?? '',
    tokens: body.usage?.total_tokens ?? 0,
    latency,
  };
}

function extractSpec(text) {
  const cleaned = text.replace(/```json?\n?/g, '').replace(/```\n?/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}') + 1;
  if (start === -1 || end === 0) throw new Error('no JSON object found');
  return JSON.parse(cleaned.slice(start, end));
}

/** Judge one response: structural gates + rubric + a2ui + expectations. */
function judge(content, wants) {
  let spec;
  try {
    spec = extractSpec(content);
  } catch (e) {
    return { structuralOk: false, ok: false, errors: [{ code: 'UNPARSEABLE', msg: e.message }], rubricFails: [], a2uiComponents: 0, spec: null };
  }
  const structural = validate(spec);
  const rub = structural.ok ? rubric(spec) : { fails: [], counts: null };
  const a2ui = structural.ok && rub.fails.length === 0 ? specToA2UI(spec, {}) : null;
  return {
    structuralOk: structural.ok,
    ok: structural.ok && rub.fails.length === 0,
    errors: structural.errors ?? [],
    rubricFails: rub.fails,
    counts: rub.counts,
    a2uiComponents: a2ui?.ok ? a2ui.a2ui.components.length : 0,
    expect: expectations(spec, wants),
    spec,
  };
}

const codesOf = (j) => [...j.errors.map((e) => `${e.code}:${e.msg ?? ''}`), ...j.rubricFails.map((f) => `${f.code}:${f.msg}`)].join('; ').slice(0, 400);

// ---- the census -------------------------------------------------------------
const rows = [];
for (const category of selected) {
  const messages = [
    { role: 'system', content: SYSTEM_V1 },
    { role: 'user', content: category.prompt },
  ];
  for (let i = 0; i < RUNS; i++) {
    const row = { category: category.id, axis: category.axis, run: i + 1 };
    try {
      const first = await callModel(messages);
      const judged = judge(first.content, category.expect ?? []);
      Object.assign(row, {
        firstOk: judged.ok, structuralOk: judged.structuralOk, finalOk: judged.ok,
        tokens: first.tokens, latency: first.latency, a2uiComponents: judged.a2uiComponents,
        counts: judged.counts, expect: judged.expect,
        errors: judged.errors, rubricFails: judged.rubricFails,
        // The first-pass failure classes are the census signal — they survive
        // a successful retry (the final-state fields above may be cleared).
        firstPassErrors: judged.errors, firstPassRubricFails: judged.rubricFails,
      });
      if (!judged.ok) row.firstRawExcerpt = first.content.slice(0, 800);
      if (!judged.ok) {
        const retry = await callModel([...messages, { role: 'assistant', content: first.content },
          { role: 'user', content: `你上次的输出未通过校验：${codesOf(judged)}。重新输出完整的 JSON spec，只输出 JSON。` }]);
        const rejudged = judge(retry.content, category.expect ?? []);
        row.finalOk = rejudged.ok;
        row.tokens += retry.tokens;
        row.latency += retry.latency;
        if (rejudged.ok) { row.errors = []; row.rubricFails = []; row.counts = rejudged.counts; row.expect = rejudged.expect; }
        else row.finalRawExcerpt = retry.content.slice(0, 800);
        row.retried = true;
      }
      console.log(`${category.id} #${row.run}: structural ${row.structuralOk ? 'PASS' : 'FAIL'} → rubric ${row.firstOk ? 'PASS' : 'FAIL'} → final ${row.finalOk ? 'PASS' : 'FAIL'} tokens=${row.tokens} latency=${row.latency}ms`);
    } catch (e) {
      Object.assign(row, { firstOk: false, structuralOk: false, finalOk: false, tokens: 0, latency: 0, errors: [{ code: 'HTTP', msg: e.message.slice(0, 160) }], rubricFails: [] });
      console.log(`${category.id} #${row.run}: ERROR ${e.message.slice(0, 120)}`);
    }
    rows.push(row);
  }
}

// ---- summary + ledger -------------------------------------------------------
const median = (arr) => (arr.length ? arr[Math.floor(arr.length / 2)] : 0);
const p95 = (arr) => (arr.length ? arr[Math.min(arr.length - 1, Math.floor(arr.length * 0.95))] : 0);
const byCategory = {};
for (const category of selected) {
  const rs = rows.filter((r) => r.category === category.id);
  byCategory[category.id] = {
    axis: category.axis,
    runs: rs.length,
    structuralFirstPass: rs.filter((r) => r.structuralOk).length,
    rubricFirstPass: rs.filter((r) => r.firstOk).length,
    finalPass: rs.filter((r) => r.finalOk).length,
    expectHits: rs.flatMap((r) => r.expect ?? []).filter((e) => e.hit).length,
    expectTotal: rs.flatMap((r) => r.expect ?? []).length,
    tokensP50: median(rs.map((r) => r.tokens).filter(Boolean)),
    latencyP50: median(rs.map((r) => r.latency).filter(Boolean)),
  };
}
const firstPassHistogram = {};
const finalFailHistogram = {};
for (const r of rows) {
  for (const e of [...(r.firstPassErrors ?? r.errors ?? []), ...(r.firstPassRubricFails ?? r.rubricFails ?? [])]) {
    firstPassHistogram[e.code] = (firstPassHistogram[e.code] ?? 0) + 1;
  }
  if (!r.finalOk) {
    for (const e of [...(r.errors ?? []), ...(r.rubricFails ?? [])]) {
      finalFailHistogram[e.code] = (finalFailHistogram[e.code] ?? 0) + 1;
    }
  }
}
const failureClasses = Object.entries(firstPassHistogram).sort((a, b) => b[1] - a[1]);
const finalFailureClasses = Object.entries(finalFailHistogram).sort((a, b) => b[1] - a[1]);

console.log(`\n--- appgen-eval summary (${MODEL} × ${rows.length} runs) ---`);
for (const [id, s] of Object.entries(byCategory)) {
  console.log(`${id.padEnd(16)} structural ${s.structuralFirstPass}/${s.runs}  rubric ${s.rubricFirstPass}/${s.runs}  final ${s.finalPass}/${s.runs}  expect ${s.expectHits}/${s.expectTotal}  tokens ${s.tokensP50}  ${s.latencyP50}ms`);
}
console.log(`first-pass failure classes: ${failureClasses.map(([c, n]) => `${c}×${n}`).join('  ') || 'none'}`);
console.log(`final (post-retry) failures: ${finalFailureClasses.map(([c, n]) => `${c}×${n}`).join('  ') || 'none'}`);

const ledger = {
  meta: {
    at: new Date().toISOString(), model: MODEL, promptSet: PROMPTSET_VERSION, systemPrompt: 'SYSTEM_V1',
    runsPerCategory: RUNS, categories: selected.map((c) => c.id), temperature: 0.7,
    okDefinition: 'validate() four gates AND design-constitution rubric (machine-checkable half)',
  },
  summary: byCategory,
  failureClasses,
  finalFailureClasses,
  rows,
};
const outDir = new URL('../../tools/dev-web-carrier/artifacts/appgen-eval/', import.meta.url);
mkdirSync(outDir, { recursive: true });
const outPath = new URL(`../../tools/dev-web-carrier/artifacts/appgen-eval/${LEDGER_STEM}.json`, import.meta.url);
writeFileSync(outPath, JSON.stringify(ledger, null, 2) + '\n');
console.log(`ledger → ${outPath.pathname}`);
