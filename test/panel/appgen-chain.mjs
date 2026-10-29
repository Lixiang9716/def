/**
 * appgen-chain: the Web-Bench shape ported to def's update tier — a chain
 * of SEQUENTIAL DEPENDENT modification tasks over one app surface (render
 * → task 1 → task 2 → …), scored at the task level with the WebGen-Bench
 * accuracy formula: accuracy = (N_yes + 0.5 × N_partial) / N_total × 100%.
 *
 * Where the port benchmark (appgen-bench-port.mjs) measures one-shot full
 * renders, this measures the hard part: does generation COMPOUND — each
 * task is asked against the surface as it stands after the previous task
 * (the product's own update semantics: an INCREMENTAL payload merged over
 * the current truth via the same mergeUpdate the appshell_update tool
 * runs, then the same four gates). A task whose merged spec fails
 * validation scores NO and the chain CONTINUES from the last valid truth
 * — exactly what the product does when it refuses an update.
 *
 * Generator: LLM_* (fallback DSH_LLM_*, then ZAI_*); judge: JUDGE_* (keep
 * a different family). Knobs: CHAIN_SEEDS (first N seeds), LEDGER_STEM.
 * Not a CI gate — the loop's backend-axis percentage benchmark
 * (doc/appgen-auto-research.md).
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { validate, mergeUpdate } from '../../system-plugins/dsh-appshell/lib/validate.js';
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
const LEDGER_STEM = process.env.LEDGER_STEM || 'appgen-chain';
const SYSTEM_VERSION = process.env.APPGEN_SYSTEM === 'V1' ? 'V1' : 'V2';
const SYSTEM = SYSTEM_VERSION === 'V1' ? SYSTEM_V1 : SYSTEM_V2;
const N_SEEDS = Number(process.env.CHAIN_SEEDS || 4);
for (const [k, v] of Object.entries({ gen: GEN, judge: JUDGE })) {
  if (!v.apiKey || !v.baseURL) { console.error(`appgen-chain: missing ${k} credentials`); process.exit(1); }
}

// The chains: seed app + sequential tasks, each phrased as a user ask that
// builds on what earlier tasks added (the Web-Bench dependency shape).
const SEEDS = [
  {
    id: 'music-player',
    prompt: '做一个音乐播放器应用的首页：顶部搜索栏，中间是每日推荐的横幅卡片，下面是三个推荐歌单的横向卡片列表，最底下有一个正在播放的迷你播放条。主题色用红色。',
    tasks: [
      '在搜索栏左边加一个扫一扫入口按钮（action 叫 scan.open）',
      '把主题色从红色换成紫色 #7c4dff',
      '在歌单列表下面新增一行「本周新碟」横向卡片，含两张封面卡片',
    ],
  },
  {
    id: 'wallet',
    prompt: '做一个钱包应用的首页：顶部显示账户总资产和本月收支，中间是四个常用功能入口（扫码付款、转账、充值、账单），下面是最近的交易记录列表。主题色用深蓝。',
    tasks: [
      '在总资产下面加一行本月结余的进度条（progress），显示已消费 68%',
      '把主题色换成金色 #d4a017',
      '在交易记录列表下面新增一个「账单导出」按钮（action 叫 bill.export）',
    ],
  },
  {
    id: 'pomodoro',
    prompt: '做一个番茄钟专注应用的首页：中间是一个大的倒计时进度（显示剩余 25:00），下面显示今日完成的番茄数和专注时长统计，底部有开始专注和休息两个按钮。主题色用番茄红。',
    tasks: [
      '在统计区下面新增今日任务清单（可勾选的三行）',
      '把主题色换成墨绿色 #1f6f54',
      '在页面顶部加一个白噪音开关按钮（action 叫 noise.toggle）',
    ],
  },
  {
    id: 'chat',
    prompt: '做一个即时通讯应用的首页：顶部搜索栏，中间是最近的会话列表（头像、昵称、最后一条消息、时间），底部是四个标签页。主题色用绿色。',
    tasks: [
      '在会话列表上面加一行「未读消息 12 条」的横幅卡片',
      '把主题色换成天蓝色 #2f9ee8',
      '在横幅卡片上加一个「全部已读」按钮（action 叫 msg.readall）',
    ],
  },
].slice(0, N_SEEDS);

const call = (which, messages, temperature) => fetch(`${which.baseURL}/chat/completions`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${which.apiKey}` },
  body: JSON.stringify({ model: which.model, messages, temperature }),
});

async function genText(messages, temperature = 0.7) {
  const res = await call(GEN, messages, temperature);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text().then((t) => t.slice(0, 160))}`);
  const body = await res.json();
  return { content: body.choices?.[0]?.message?.content ?? '', tokens: body.usage?.total_tokens ?? 0 };
}

function extractJson(text) {
  const cleaned = text.replace(/```json?\n?/g, '').replace(/```\n?/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}') + 1;
  if (start === -1 || end === 0) throw new Error('no JSON object found');
  return JSON.parse(cleaned.slice(start, end));
}

const JUDGE_SYSTEM = `You grade ONE modification task against an app-shell spec — a declarative description of ONE mobile app screen (component tree; tabs switch sections; "actions" are declared interactive capabilities; templates: search-bar, tab-bar, chat-row, service-grid, banner-card, hcard-row, balance-card, mini-player, progressbar).

Decide whether the task's requested change is present in THIS spec:
- YES: the change is fully and correctly reflected (the requested element/state exists with the requested content or behavior).
- PARTIAL: something of the change landed but incomplete or off-spec (wrong theme color partially applied, element present but missing the requested action, etc.).
- NO: the spec shows no trace of the requested change.
Reply ONLY JSON: {"v":"YES"|"PARTIAL"|"NO","why":"<=14 words"}`;

async function judgeTask(task, spec) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await call(JUDGE, [
      { role: 'system', content: JUDGE_SYSTEM },
      { role: 'user', content: `Task: ${task}\n\nSpec:\n${JSON.stringify(spec)}` },
    ], 0);
    if (!res.ok) continue;
    const body = await res.json();
    const text = body.choices?.[0]?.message?.content ?? '';
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}') + 1;
    if (start === -1 || end === 0) continue;
    try {
      const parsed = JSON.parse(text.slice(start, end));
      if (['YES', 'PARTIAL', 'NO'].includes(parsed.v)) return parsed;
    } catch { /* retry */ }
  }
  return null;
}

const UPDATE_SYSTEM = SYSTEM + '\n\nYou are UPDATING an existing surface. Output ONLY a JSON object: "screen" is REQUIRED in every update — always the COMPLETE new tree as one object, even when the task only changes colors or adds one element; "theme"/"tabs"/"actions" ride along only when the task touches them. No markdown, no commentary.';

/** Run one chain task: generate the incremental update, merge it over the
 * current truth through the product's own mergeUpdate + four gates, judge
 * the task. Mutates `current` in place when the update lands. */
async function runTask(seed, task, state) {
  const step = { task };
  let payload = null;
  try {
    const up = await genText([
      { role: 'system', content: UPDATE_SYSTEM },
      { role: 'user', content: `Current spec:\n${JSON.stringify(state.current)}\n\nTask: ${task}` },
    ]);
    state.genTokens += up.tokens;
    payload = extractJson(up.content);
  } catch (e) {
    step.verdict = 'NO';
    step.why = 'update unparseable: ' + e.message.slice(0, 60);
  }
  if (payload === null) return step;
  const merged = mergeUpdate(state.current, payload);
  const checked = merged === null ? { ok: false } : validate(merged);
  if (!checked.ok) {
    step.verdict = 'NO';
    step.why = 'merged spec rejected: ' + (checked.errors?.[0]?.code ?? 'invalid');
    step.refusal = checked.errors?.[0]?.msg?.slice(0, 140);
    return step;
  }
  state.current = merged;
  const judged = await judgeTask(task, state.current);
  if (judged === null) { step.verdict = null; step.why = 'judge failed'; }
  else { step.verdict = judged.v; step.why = judged.why; }
  return step;
}

const rows = [];
for (const seed of SEEDS) {
  const row = { seed: seed.id, tasks: seed.tasks.length, steps: [] };
  try {
    const first = await genText([
      { role: 'system', content: SYSTEM },
      { role: 'user', content: seed.prompt },
    ]);
    let current = null;
    let renderCheck = { ok: false, errors: [{ code: 'UNPARSEABLE', msg: 'generation was not a JSON object' }] };
    try {
      current = extractJson(first.content);
      renderCheck = validate(current);
    } catch (e) {
      renderCheck = { ok: false, errors: [{ code: 'UNPARSEABLE', msg: e.message.slice(0, 120) }] };
    }
    const baseOk = renderCheck.ok;
    row.renderOk = baseOk;
    if (!baseOk) row.renderError = renderCheck.errors?.[0]?.msg?.slice(0, 160);
    row.gen_tokens = first.tokens;
    if (!baseOk) {
      row.steps = seed.tasks.map((t) => ({ task: t, verdict: 'NO', why: 'render start-failed: ' + (renderCheck.errors?.[0]?.code ?? '?') }));
    } else {
      const state = { current, genTokens: row.gen_tokens };
      for (const task of seed.tasks) {
        const step = await runTask(seed, task, state);
        row.steps.push(step);
        console.log(`${seed.id} | ${task.slice(0, 24)}… → ${step.verdict ?? 'EXCLUDED'} ${step.why ? '(' + step.why.slice(0, 60) + ')' : ''}`);
      }
      row.gen_tokens = state.genTokens;
    }
  } catch (e) {
    row.error = e.message.slice(0, 160);
    row.steps = seed.tasks.map((t) => ({ task: t, verdict: 'NO', why: 'error: ' + row.error }));
  }
  rows.push(row);
}

// ---- aggregate: the upstream formula at task level, plus the chain-decay
// view (Web-Bench's point: do later, dependent tasks survive?) -----------
const VERDICTS = new Set(['YES', 'PARTIAL', 'NO']);
const all = rows.flatMap((r) => r.steps).filter((s) => VERDICTS.has(s.verdict));
const acc = (vs) => {
  const yes = vs.filter((v) => v.verdict === 'YES').length;
  const partial = vs.filter((v) => v.verdict === 'PARTIAL').length;
  return { yes, partial, no: vs.length - yes - partial, accuracy: vs.length ? Math.round((yes + 0.5 * partial) / vs.length * 1000) / 10 : null };
};
const overall = acc(all);
const byPosition = {};
for (const s of all) {
  const idx = rows.flatMap((r) => r.steps).indexOf(s);
  const pos = rows.find((r) => r.steps.includes(s)).steps.indexOf(s) + 1;
  (byPosition[pos] ??= []).push(s);
}
const positions = Object.fromEntries(Object.entries(byPosition).map(([p, vs]) => [p, acc(vs)]));
const rejected = rows.flatMap((r) => r.steps).filter((s) => s.refusal).length;

console.log(`\n--- appgen-chain (${GEN.model} gen × ${JUDGE.model} judge, ${rows.length} chains / ${rows.reduce((n, r) => n + r.tasks, 0)} tasks, SYSTEM_${SYSTEM_VERSION}) ---`);
console.log(`CHAIN ACCURACY: ${overall.accuracy}%  (YES ${overall.yes} / PARTIAL ${overall.partial} / NO ${overall.no} of ${all.length})`);
for (const [p, v] of Object.entries(positions)) console.log(`  position ${p}: ${v.accuracy}%`);
console.log(`update refusals (merged spec rejected by gates): ${rejected}`);

const ledger = {
  meta: {
    at: new Date().toISOString(), generator: GEN.model, judge: JUDGE.model,
    systemPrompt: 'SYSTEM_' + SYSTEM_VERSION, seeds: rows.map((r) => r.seed),
    formula: 'accuracy = (N_yes + 0.5*N_partial) / N_total * 100 (task level, WebGen-Bench formula over the Web-Bench chain shape)',
  },
  overall, positions,
  diagnostics: { rejectedUpdates: rejected },
  rows,
};
const outDir = new URL('../../tools/dev-web-carrier/artifacts/appgen-bench/', import.meta.url);
mkdirSync(outDir, { recursive: true });
const outPath = new URL(`../../tools/dev-web-carrier/artifacts/appgen-bench/${LEDGER_STEM}.json`, import.meta.url);
writeFileSync(outPath, JSON.stringify(ledger, null, 2) + '\n');
console.log(`ledger → ${outPath.pathname}`);
