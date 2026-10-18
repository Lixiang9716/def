// Streaming TTFT probe: glm-4.6, stream:true, the M4 morph prompt.
// Measures: TTFT (first SSE data chunk), first-valid-partial-spec (lenient
// JSON prefix parse yields a screen with >=1 closed component), completion.
import { readFileSync } from 'node:fs';
// The repo-root .env is optional — explicit LLM_* process env alone works.
let env = {};
try {
  env = Object.fromEntries(
    readFileSync(new URL('../../.env', import.meta.url), 'utf8')
      .split('\n').filter((l) => l.includes('=') && !l.startsWith('#'))
      .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
} catch { /* env-only mode */ }
const BASE_URL = process.env.LLM_BASE_URL || env.ZAI_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4';
const API_KEY = process.env.LLM_API_KEY || env.ZAI_API_KEY;
const MODEL = process.env.LLM_MODEL || env.ZAI_MODEL || 'glm-4.6';

const SYSTEM = 'You are a UI spec generator. Output ONLY a valid JSON object matching the app-shell/0.9 schema — no markdown, no commentary. Schema: {"spec":"app-shell/0.9","theme":{"accent":"#RRGGBB"},"tabs":[2-5 strings],"actions":["dot.case.ids"],"screen":{component tree}}. Components: text/button/row/column/card/badge/search-bar/banner-card/hcard-row/balance-card/mini-player/service-grid/chat-row/progressbar/image. Rules: action ids dot.case and declared in actions[]; text fields plain strings; children max 24.';
const PROMPT = '做一个音乐播放器应用的首页：顶部搜索栏，中间是每日推荐横幅，四个快捷入口，三个推荐歌单横卡，底部迷你播放条。主题红色。只输出 JSON。';

// Minimal JSON-prefix parser: returns the deepest CLOSED structure parseable
// from the prefix (object/array closed by brace/bracket balancing, strings
// closed by quote). Enough to detect "theme arrived", "screen opening".
function closedPrefix(json) {
  let depth = 0, inStr = false, esc = false, lastClosed = -1;
  for (let i = 0; i < json.length; i++) {
    const c = json[i];
    if (esc) { esc = false; continue; }
    if (c === '\\') { if (inStr) esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') { depth--; if (depth === 0) lastClosed = i; }
  }
  if (lastClosed < 0) return null;
  // wrap in an object so the whole prefix parses as one value list
  try { return JSON.parse('[' + json.slice(0, lastClosed + 1).replace(/,\s*$/, '') + ']'); } catch { return null; }
}

const t0 = Date.now();
const res = await fetch(`${BASE_URL}/chat/completions`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
  body: JSON.stringify({ model: MODEL, stream: true, messages: [
    { role: 'system', content: SYSTEM }, { role: 'user', content: PROMPT },
  ] }),
});
if (!res.ok) { console.error('HTTP', res.status, await res.text()); process.exit(1); }
const reader = res.body.getReader();
const dec = new TextDecoder();
let buf = '', acc = '', ttft = null, themeAt = null, screenAt = null, firstCompAt = null, done = null;
while (true) {
  const { value, done: rdone } = await reader.read();
  if (rdone) break;
  buf += dec.decode(value, { stream: true });
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (payload === '[DONE]') { done = Date.now() - t0; continue; }
    let delta;
    try { delta = JSON.parse(payload).choices?.[0]?.delta; } catch { continue; }
    const text = delta?.content ?? '';
    if (!text) continue;
    if (ttft === null) ttft = Date.now() - t0;
    acc += text;
    if (themeAt === null && /"theme"\s*:\s*{[^}]*}/.test(acc)) themeAt = Date.now() - t0;
    if (screenAt === null && /"screen"/.test(acc)) screenAt = Date.now() - t0;
    if (firstCompAt === null && /"type"\s*:\s*"(text|button|card|badge|banner-card|hcard-row|balance-card|mini-player|service-grid|column|row|search-bar)"/.test(acc)) firstCompAt = Date.now() - t0;
  }
}
console.log(JSON.stringify({
  model: MODEL, ttftMs: ttft, themeAtMs: themeAt, screenAtMs: screenAt,
  firstComponentAtMs: firstCompAt, fullDoneMs: done, chars: acc.length,
}, null, 1));
