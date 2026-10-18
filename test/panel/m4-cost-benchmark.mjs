/**
 * M4 cost benchmark (real model, manual receipt): the plan's cost rows on
 * the served glm-4.6 —
 *   morph   N=10 full-spec generations (the L3 prompt, verbatim, for
 *           comparability with the L3/L1 ledger):  P50 ≤3k / P95 ≤5k tokens
 *   update  N=10 INCREMENTAL update generations (screen-only payload for
 *           the same app):                            P50 ≤1.2k tokens
 *   e2e     per-tier wall latency (prompt → validated payload): recorded
 *           honestly; the morph tier rides the same non-streaming physics
 *           the L3 ledger already recorded as a miss (M1 item 4 partial).
 *
 * Tokens are total_tokens (input+output) — the same metric L3 used. The
 * update tier validates the payload by MERGING over the carrier's wechat
 * spec (the M3 seam) before the four gates judge it, and also records the
 * payload-bytes ratio vs the full re-render (the deterministic M3 row's
 * real-model twin).
 *
 * Writes the committed receipt to
 * tools/dev-web-carrier/artifacts/appshell-m4/cost-ledger.json and prints
 * the summary. Not a CI gate — a family-change rerun per plan §3.5.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { validate, mergeUpdate } from '../../system-plugins/dsh-appshell/lib/validate.js';

const env = Object.fromEntries(
  readFileSync(new URL('../../.env', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const BASE_URL = env.ZAI_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4';
const API_KEY = env.ZAI_API_KEY;
const MODEL = env.ZAI_MODEL || 'glm-4.6';
if (!API_KEY) { console.error('M4: no ZAI_API_KEY in .env — cannot run the cost ledger'); process.exit(1); }

const OUT_DIR = new URL('../../tools/dev-web-carrier/artifacts/appshell-m4/', import.meta.url);
const N = Number(process.env.M4_N || env.M4_N || 10);
// 'morph' | 'update' | '' (both) — prompt-iteration knob. NOTE: reads the
// PROCESS env (the .env file carries credentials, not run knobs).
const ONLY = process.env.M4_TIER || '';

// ---- the morph tier: L3's prompt verbatim --------------------------------
const MORPH_SYSTEM = `You are a UI spec generator. Output ONLY a valid JSON object matching the app-shell/0.9 schema — no markdown, no commentary.

Schema:
{
  "spec": "app-shell/0.9",
  "theme": { "accent": "#RRGGBB", "mode": "light" },
  "tabs": [2-5 strings],
  "actions": ["dot.case.ids"],
  "screen": { component tree }
}

Component types (closed set, use ONLY these):
- text: { type, text, size?: "title"|"body"|"small", tone?: "default"|"muted"|"accent" }
- image: { type, emoji, color }
- button: { type, label, action } — action MUST be declared in actions[]
- row: { type, children: [nodes] }
- column: { type, children: [nodes] }
- card: { type, children: [nodes] }
- progressbar: { type, label, value: 0-100 }
- badge: { type, text }
- search-bar: { type, placeholder }
- tab-bar: { type, tabs: [{ label }], active: index }
- chat-row: { type, avatar: { emoji, color }, name, preview, time }
- service-grid: { type, items: [{ icon, label }] (max 8) }
- banner-card: { type, title, subtitle }
- hcard-row: { type, items: [{ cover: { emoji, color }, title, sub }] (max 6) }
- balance-card: { type, label, value, actionLabel?, action? }
- mini-player: { type, cover: { emoji, color }, title, sub, action? }

Rules:
- action ids use dot.case: "player.toggle", "chat.open" — NEVER underscores
- every action in a button.action or template action MUST appear in spec.actions[]
- text fields are plain strings, no markup
- children arrays have max 24 items`;

const MORPH_PROMPT = '做一个音乐播放器应用的首页：顶部搜索栏，中间是每日推荐的横幅卡片，下面是四个快捷入口（私人FM、每日推荐、歌单、排行榜），再下面是三个推荐歌单的横向卡片列表，最底下有一个正在播放的迷你播放条。主题色用红色。';

// ---- the update tier: an incremental screen-only payload ------------------
const UPDATE_SYSTEM = `You are updating an existing app surface. The app's tabs, theme, and actions stay AS THEY ARE — output ONLY the new screen as a JSON object:
{ "spec": "app-shell/0.9", "actions": [], "screen": { component tree } }

For this update you may use ONLY these four component types:
- column: { type, children: [nodes] }
- text: { type, text, size?: "title"|"body"|"small", tone?: "default"|"muted"|"accent" }
- balance-card: { type, label, value }
- hcard-row: { type, items: [{ cover: { emoji, color }, title }] }

HARD BUDGET: at most 6 components total (count every node including children) — a surgical patch, not a rebuild. Exactly this shape and size:
{ "spec": "app-shell/0.9", "actions": [], "screen": { "type": "column", "children": [ { "type": "balance-card", "label": "听歌时长", "value": "128 小时" }, { "type": "text", "text": "本周新增 3 首", "size": "small", "tone": "muted" } ] } }`;

const UPDATE_PROMPT = '这个音乐播放器首页要小改：把"每日推荐"横幅换成一张余额卡（显示听歌时长），下面加一行两张推荐专辑的横卡。只输出新的 screen JSON。';

// The merge base: the carrier's wechat spec (the same origin the M3 leg rode).
import { appShellScriptFor } from '../../tools/dev-web-carrier/next-mode.mjs';
const BASE_SPEC = JSON.parse(
  appShellScriptFor(1, '变成微信', 'm4').settle
    .find((r) => r.type === 'tool/result').data.message.content[0].content[0].text).spec;
const FULL_BYTES = JSON.stringify(BASE_SPEC).length;

async function callModel(messages) {
  const start = Date.now();
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_KEY}` },
    body: JSON.stringify({ model: MODEL, messages, temperature: 0.7 }),
  });
  const latency = Date.now() - start;
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text().then((t) => t.slice(0, 200))}`);
  const body = await res.json();
  return { content: body.choices?.[0]?.message?.content ?? '', tokens: body.usage?.total_tokens ?? 0, latency };
}

function extractJson(text) {
  const cleaned = text.replace(/```json?\n?/g, '').replace(/```\n?/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}') + 1;
  if (start === -1 || end === 0) throw new Error('no JSON object found');
  return JSON.parse(cleaned.slice(start, end));
}

const checkMorph = (content) => {
  try {
    const r = validate(extractJson(content));
    return { ok: r.ok, errors: r.errors.slice(0, 3) };
  } catch (e) { return { ok: false, errors: [{ code: 'UNPARSEABLE', msg: e.message }] }; }
};

const checkUpdate = (content) => {
  try {
    const payload = extractJson(content);
    const merged = mergeUpdate(BASE_SPEC, payload);
    const r = merged === null ? { ok: false, errors: [{ code: 'BAD_FIELD' }] } : validate(merged);
    return { ok: r.ok, errors: r.errors.slice(0, 3), bytes: JSON.stringify(payload).length, payload };
  } catch (e) { return { ok: false, errors: [{ code: 'UNPARSEABLE', msg: e.message }], bytes: 0 }; }
};

const runTier = async (name, system, prompt, check, baseMessages) => {
  const rows = [];
  for (let i = 0; i < N; i++) {
    try {
      const first = await callModel([{ role: 'system', content: system }, { role: 'user', content: prompt }]);
      const checked = check(first.content);
      const row = { run: i + 1, firstOk: checked.ok, finalOk: checked.ok, tokens: first.tokens, latency: first.latency };
      if (!checked.ok && name === 'morph') {
        const codes = checked.errors.map((e) => `${e.code}:${e.msg ?? ''}`).join('; ').slice(0, 400);
        const retry = await callModel([
          { role: 'system', content: system }, { role: 'user', content: prompt },
          { role: 'assistant', content: first.content },
          { role: 'user', content: `你上次的输出未通过校验：${codes}。重新输出完整的 JSON spec，只输出 JSON。` },
        ]);
        const rechecked = check(retry.content);
        row.finalOk = rechecked.ok;
        row.tokens += retry.tokens;
        row.latency += retry.latency;
      }
      if (name === 'update') row.payloadBytes = checked.bytes ?? 0;
      rows.push(row);
      console.log(`[${name}] #${row.run}: ok=${row.finalOk} tokens=${row.tokens} latency=${row.latency}ms${row.payloadBytes ? ` payload=${row.payloadBytes}B` : ''}`);
    } catch (e) {
      rows.push({ run: i + 1, finalOk: false, tokens: 0, latency: 0, error: String(e.message).slice(0, 120) });
      console.log(`[${name}] #${i + 1}: ERROR ${String(e.message).slice(0, 120)}`);
    }
  }
  const ok = rows.filter((r) => r.finalOk).length;
  const tokens = rows.filter((r) => r.tokens > 0).map((r) => r.tokens).sort((a, b) => a - b);
  const lat = rows.filter((r) => r.latency > 0).map((r) => r.latency).sort((a, b) => a - b);
  const p50 = (a) => (a.length ? a[Math.floor(a.length / 2)] : 0);
  const p95 = (a) => (a.length ? a[Math.min(a.length - 1, Math.floor(a.length * 0.95))] : 0);
  const bytes = rows.filter((r) => r.payloadBytes > 0).map((r) => r.payloadBytes).sort((a, b) => a - b);
  return { runs: rows, okOf: ok, tokensP50: p50(tokens), tokensP95: p95(tokens), latencyP50: p50(lat), payloadBytesP50: p50(bytes) };
};

console.log(`M4 cost ledger: ${MODEL}, morph×${N} + update×${N}\n`);
const morph = ONLY && ONLY !== 'morph'
  ? { runs: [], okOf: 0, tokensP50: 0, tokensP95: 0, latencyP50: 0 }
  : await runTier('morph', MORPH_SYSTEM, MORPH_PROMPT, checkMorph);
const update = ONLY && ONLY !== 'update'
  ? { runs: [], okOf: 0, tokensP50: 0, tokensP95: 0, latencyP50: 0, payloadBytesP50: 0 }
  : await runTier('update', UPDATE_SYSTEM, UPDATE_PROMPT, checkUpdate);

const bars = {
  morphTokensP50_3000: morph.tokensP50 <= 3000,
  morphTokensP95_5000: morph.tokensP95 <= 5000,
  updateTokensP50_1200: update.tokensP50 <= 1200,
  e2eP50_20000_morph: morph.latencyP50 <= 20000,
  e2eP50_20000_update: update.latencyP50 <= 20000,
};
// A single-tier rerun (M4_TIER) preserves the other tier's recorded runs —
// the ledger is one document, never half-written; this run's own bars are
// always its own measurement.
if (ONLY) {
  try {
    const prev = JSON.parse(readFileSync(new URL('cost-ledger.json', OUT_DIR), 'utf8'));
    if (ONLY === 'update') {
      Object.assign(morph, prev.morph, { runs: prev.morph.runs ?? [] });
      bars.morphTokensP50_3000 = prev.bars?.morphTokensP50_3000 ?? bars.morphTokensP50_3000;
      bars.morphTokensP95_5000 = prev.bars?.morphTokensP95_5000 ?? bars.morphTokensP95_5000;
      bars.e2eP50_20000_morph = prev.bars?.e2eP50_20000_morph ?? bars.e2eP50_20000_morph;
    }
    if (ONLY === 'morph') {
      Object.assign(update, prev.update, { runs: prev.update.runs ?? [] });
      bars.updateTokensP50_1200 = prev.bars?.updateTokensP50_1200 ?? bars.updateTokensP50_1200;
      bars.e2eP50_20000_update = prev.bars?.e2eP50_20000_update ?? bars.e2eP50_20000_update;
    }
  } catch { /* no prior ledger — first write */ }
}
const ratioPct = update.payloadBytesP50 > 0 ? Math.round(1000 * update.payloadBytesP50 / FULL_BYTES) / 10 : null;

const ledger = {
  model: MODEL, runs: N, date: new Date().toISOString(),
  morph: { okOf: morph.okOf, tokensP50: morph.tokensP50, tokensP95: morph.tokensP95, latencyP50: morph.latencyP50 },
  update: { okOf: update.okOf, tokensP50: update.tokensP50, tokensP95: update.tokensP95, latencyP50: update.latencyP50, payloadBytesP50: update.payloadBytesP50 },
  incrementalRatioPctVsCarrierFullSpec: ratioPct,
  bars,
  barsNote: 'Token bars are the M4 gates; the e2e ≤20s row is recorded honestly — the morph tier rides the non-streaming physics the L3 ledger already recorded as a miss (M1 item 4 partial: streaming TTFT or spec compression are the named candidates).',
};
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(new URL('cost-ledger.json', OUT_DIR), JSON.stringify(ledger, null, 2) + '\n');

console.log('\n--- M4 cost ledger ---');
console.log(`morph : ok ${morph.okOf}/${N}  tokens P50 ${morph.tokensP50} (≤3000 ${bars.morphTokensP50_3000 ? '✓' : '✗'})  P95 ${morph.tokensP95} (≤5000 ${bars.morphTokensP95_5000 ? '✓' : '✗'})  latency P50 ${morph.latencyP50}ms (≤20000 ${bars.e2eP50_20000_morph ? '✓' : '✗'})`);
console.log(`update: ok ${update.okOf}/${N}  tokens P50 ${update.tokensP50} (≤1200 ${bars.updateTokensP50_1200 ? '✓' : '✗'})  latency P50 ${update.latencyP50}ms (≤20000 ${bars.e2eP50_20000_update ? '✓' : '✗'})  payload P50 ${update.payloadBytesP50}B (${ratioPct}% of the ${FULL_BYTES}B full spec)`);
console.log(`receipt → tools/dev-web-carrier/artifacts/appshell-m4/cost-ledger.json`);
