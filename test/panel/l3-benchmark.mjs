/**
 * L3 real-model benchmark: send the same prompt to glm-4.6 N times, run
 * each response through the four-gate validator, report pass rate, tokens,
 * and latency. Uses the served ZAI credentials from .env.
 *
 * M1 acceptance: first-pass ≥8/10; with retry ≥9/10; tokens ≤3k; ≤15s.
 */
import { readFileSync } from 'node:fs';
import { validate } from '../../system-plugins/dsh-appshell/lib/validate.js';
import { expandedToA2UI } from '../../system-plugins/dsh-appshell/lib/appshell-to-a2ui.js';

// Load .env (KEY=VALUE lines, skip comments and blanks)
const env = Object.fromEntries(
  readFileSync(new URL('../../.env', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const BASE_URL = env.ZAI_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4';
const API_KEY = env.ZAI_API_KEY;
const MODEL = env.ZAI_MODEL || 'glm-4.6';

if (!API_KEY) { console.error('L3: no ZAI_API_KEY in .env — cannot run real-model benchmark'); process.exit(1); }

const SYSTEM = `You are a UI generator. Given a description, produce an app-shell/0.9 JSON spec.
The spec object has: spec (always "${'app-shell/0.9'}"), theme: {accent: "#RRGGBB", mode: "light"|"dark"}, tabs: [2..5 strings], actions: [action ids], screen: a component tree.
Component types (closed set): text, image, button, row, column, card, progressbar, badge, search-bar, tab-bar, chat-row, service-grid, banner-card, hcard-row, balance-card, mini-player.
Every button.action must be declared in actions. Text fields are plain text (no markup).
Respond with ONLY the JSON spec object — no markdown fences, no commentary.`;

const PROMPT = '做一个音乐播放器应用的首页：顶部搜索栏，中间是每日推荐的横幅卡片，下面是四个快捷入口（私人FM、每日推荐、歌单、排行榜），再下面是三个推荐歌单的横向卡片列表，最底下有一个正在播放的迷你播放条。主题色用红色。';

async function callModel(n) {
  const start = Date.now();
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_KEY}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: PROMPT },
      ],
      temperature: 0.7,
    }),
  });
  const latency = Date.now() - start;
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text().then(t => t.slice(0, 200))}`);
  const body = await res.json();
  const content = body.choices?.[0]?.message?.content ?? '';
  const tokens = body.usage?.total_tokens ?? 0;
  return { content, tokens, latency };
}

function extractSpec(text) {
  // Strip markdown fences if present
  const cleaned = text.replace(/```json?\n?/g, '').replace(/```\n?/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}') + 1;
  if (start === -1 || end === 0) throw new Error('no JSON object found');
  return JSON.parse(cleaned.slice(start, end));
}

const N = 10;
const results = [];
console.log(`L3 benchmark: ${MODEL} × ${N} runs\n`);

for (let i = 0; i < N; i++) {
  try {
    const { content, tokens, latency } = await callModel();
    const spec = extractSpec(content);
    const result = validate(spec);
    results.push({ run: i + 1, ok: result.ok, tokens, latency, errors: result.ok ? 0 : result.errors.length });
    console.log(`#${i + 1}: ${result.ok ? 'PASS' : 'FAIL'} tokens=${tokens} latency=${latency}ms`);
  } catch (e) {
    results.push({ run: i + 1, ok: false, tokens: 0, latency: 0, error: e.message.slice(0, 120) });
    console.log(`#${i + 1}: ERROR ${e.message.slice(0, 120)}`);
  }
}

const passed = results.filter((r) => r.ok).length;
const tokensList = results.filter((r) => r.tokens > 0).map((r) => r.tokens).sort((a, b) => a - b);
const latencies = results.filter((r) => r.latency > 0).map((r) => r.latency).sort((a, b) => a - b);
const median = (arr) => arr.length ? arr[Math.floor(arr.length / 2)] : 0;

console.log(`\n--- L3 summary ---`);
console.log(`pass: ${passed}/${N} (${Math.round(passed / N * 100)}%)`);
console.log(`tokens P50: ${median(tokensList)}  P95: ${tokensList[Math.floor(tokensList.length * 0.95)] ?? 'n/a'}`);
console.log(`latency P50: ${median(latencies)}ms`);
console.log(`M1 bars: first-pass ≥8/10 → ${passed >= 8 ? '✓' : '✗'}; tokens ≤3k → ${tokensList.every(t => !t || t <= 3000) ? '✓' : '✗'}`);
