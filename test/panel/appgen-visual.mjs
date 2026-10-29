/**
 * appgen-visual: the visual leg — the design-constitution half the static
 * judge cannot see. Generate a spec, render it in the real web client
 * (the dev carrier page + openSurface), screenshot the presented surface,
 * and ask a VISION judge what the static tier could never know: is the
 * requested background actually painted, are the named colors visible,
 * and how does it look (the appearance score; rubric v3 grades 0-100 —
 * v2's 1-5 saturated at 4 every round, hiding polish progress).
 *
 * Judge: glm-4.6v (vision, JUDGE_* env). Generator: LLM_* (deepseek
 * default). Screenshots land under artifacts/appgen-bench/shots-<stem>/
 * (local visual evidence — the committed ledger carries the judge's
 * textual verdicts; E2E-by-logs law). Knobs: VISUAL_N (instructions),
 * LEDGER_STEM. Not a CI gate.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { openCarriedPage, closeCarriedPage } from '../tools/helpers/carrier-page.mjs';
import { readPng } from '../tools/helpers/visual-diff-core.mjs';

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
  model: process.env.JUDGE_MODEL || 'glm-4.6v',
};
const LEDGER_STEM = process.env.LEDGER_STEM || 'appgen-visual';
const VISUAL_N = Number(process.env.VISUAL_N || 6);
for (const [k, v] of Object.entries({ gen: GEN, judge: JUDGE })) {
  if (!v.apiKey || !v.baseURL) { console.error(`appgen-visual: missing ${k} credentials`); process.exit(1); }
}

const corpus = JSON.parse(
  readFileSync(new URL('./appgen-bench/webgen-port.json', import.meta.url), 'utf8')
).instructions.filter((i) => /background|canvas background/i.test(i.instruction_en)).slice(0, VISUAL_N);

const call = (which, body) => fetch(`${which.baseURL}/chat/completions`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${which.apiKey}` },
  body: JSON.stringify(body),
});

async function generate(prompt) {
  const { SYSTEM_V2 } = await import('./appgen-eval/system-prompt.js');
  const res = await call(GEN, { model: GEN.model, messages: [
    { role: 'system', content: SYSTEM_V2 }, { role: 'user', content: prompt },
  ], temperature: 0.7 });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  const text = body.choices?.[0]?.message?.content ?? '';
  const cleaned = text.replace(/```json?\n?/g, '').replace(/```\n?/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}') + 1;
  if (start === -1 || end === 0) throw new Error('no JSON object');
  return JSON.parse(cleaned.slice(start, end));
}

const backgroundHitFraction = (shot, hex) => {
  const png = readPng(shot);
  const w = png.width, h = png.height;
  const target = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  let hits = 0, total = 0;
  for (let y = 8; y < h - 8; y += 24) {
    for (let x = 8; x < w - 8; x += 24) {
      const i = (y * w + x) * 4;
      const d = [0, 1, 2].reduce((sum, c) => sum + (png.data[i + c] - target[c]) * (png.data[i + c] - target[c]), 0);
      total += 1;
      if (d <= 900) hits += 1;
    }
  }
  return { fraction: total ? Math.round(hits / total * 100) / 100 : 0, total };
};

const JUDGE_SYSTEM = `You are grading a PHONE APP SCREEN (390x844) rendered from a generated spec, against the original requirement's visual asks. Grade only what is visible.
Reply ONLY JSON: {"background_painted":"YES"|"PARTIAL"|"NO","colors_visible":"<=20 words naming what component/background colors you see","appearance":<0-100 integer>,"why":"<=20 words","polish_hint":"<=12 words: the single change that would most raise polish"}
background_painted: is a non-default background tone consistent with the request visible? Near-white requested tones count as YES when clearly not the default gray/white.
appearance rubric v3 - grade ONLY layout quality, hierarchy, spacing, alignment, polish, as a 0-100 integer. Do NOT lower it for color-name exactness (a separate pixel channel grades exactness). Anchor bands — use the full range and differentiate between screens:
0-19 broken or ugly (overlapping, clipped, chaotic); 20-44 rough (works but default-looking, uneven spacing, weak hierarchy); 45-64 clean but generic (competent and readable, no deliberate composition); 65-79 well-composed (clear hierarchy, deliberate spacing and grouping); 80-89 polished (refined details, striking identity); 90-100 exceptional (no visible flaw remains).
If your polish_hint names a structural deficiency rather than a minor cosmetic tweak, the score is below 65. Most generated screens fall in 45-79; do not inflate.`;

async function judgeVisual(instruction, shotB64) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await call(JUDGE, { model: JUDGE.model, temperature: 0, messages: [{
      role: 'user',
      content: [
        { type: 'text', text: `${JUDGE_SYSTEM}\n\nRequirement: ${instruction.instruction_en}` },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${shotB64}` } },
      ],
    }] });
    if (!res.ok) continue;
    const body = await res.json();
    const text = body.choices?.[0]?.message?.content ?? '';
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}') + 1;
    if (start === -1 || end === 0) continue;
    try {
      const parsed = JSON.parse(text.slice(start, end));
      if (['YES', 'PARTIAL', 'NO'].includes(parsed.background_painted) && Number.isInteger(parsed.appearance)
        && parsed.appearance >= 0 && parsed.appearance <= 100) return parsed;
    } catch { /* retry */ }
  }
  return null;
}

const shotsDir = new URL(`../../tools/dev-web-carrier/artifacts/appgen-bench/shots-${LEDGER_STEM}/`, import.meta.url);
mkdirSync(shotsDir, { recursive: true });
const session = await openCarriedPage({ colorScheme: 'light' });
const rows = [];
try {
  for (const instruction of corpus) {
    const row = { source_id: instruction.source_id };
    try {
      const spec = await generate(instruction.prompt);
      row.theme = spec.theme ?? null;
      const opened = await session.page.evaluate(async (spec) => {
        const mod = await import(new URL('js/appshell.js', location.href).href);
        const ok = mod.openSurface({ title: 'App', spec, onAction: null });
        await new Promise((r) => setTimeout(r, 350));
        return ok;
      }, spec);
      row.opened = opened === true;
      const view = await session.page.$('#appshell-view');
      const shot = await view.screenshot({ type: 'png' });
      const shotPath = new URL(`${instruction.source_id}.png`, shotsDir);
      writeFileSync(shotPath, shot);
      row.shot = shotPath.pathname.split('/').slice(-2).join('/');
      // The pixel check owns exactness (the vision judge cannot tell
      // seashell #FFF5EE from white on a screenshot): average the shot's
      // top strip and compare against theme.background.
      // The pixel check owns exactness: grid-sample the shot — the
      // background is painted when a large fraction of the surface is
      // within tolerance of the exact hex (headers/cards may differ).
      row.pixelBackground = null;
      if (typeof spec.theme?.background === 'string' && /^#[0-9a-fA-F]{6}$/.test(spec.theme.background)) {
        const { fraction } = backgroundHitFraction(shot, spec.theme.background);
        row.pixelBackground = { target: spec.theme.background, hitFraction: fraction, painted: fraction >= 0.25 };
      }
      const verdict = await judgeVisual(instruction, shot.toString('base64'));
      if (verdict === null) { row.judge_failed = true; row.background_painted = null; row.appearance = null; }
      else {
        row.background_painted = verdict.background_painted;
        row.colors_visible = verdict.colors_visible;
        row.appearance = verdict.appearance;
        row.why = verdict.why;
        row.polish_hint = verdict.polish_hint ?? null;
      }
    } catch (e) {
      row.error = e.message.slice(0, 160);
    }
    rows.push(row);
    console.log(`${instruction.source_id}: bg ${row.background_painted ?? (row.judge_failed ? 'JUDGE-FAIL' : 'ERR')} | pixel ${row.pixelBackground ? (row.pixelBackground.painted ? 'EXACT' : 'OFF(' + row.pixelBackground.distance + ')') : '-'} | appearance ${row.appearance ?? '-'} | ${(row.colors_visible || row.why || row.error || '').slice(0, 60)}`);
  }
} finally {
  await closeCarriedPage(session);
}

const scored = rows.filter((r) => r.background_painted);
const yes = scored.filter((r) => r.background_painted === 'YES').length;
const partial = scored.filter((r) => r.background_painted === 'PARTIAL').length;
const appearances = scored.map((r) => r.appearance).sort((a, b) => a - b);
const meanAppearance = appearances.length ? Math.round(appearances.reduce((a, b) => a + b, 0) / appearances.length * 10) / 10 : null;
console.log(`\n--- appgen-visual (${GEN.model} gen × ${JUDGE.model} judge, ${rows.length} instructions) ---`);
console.log(`BACKGROUND PAINTED: ${yes} YES / ${partial} PARTIAL / ${scored.length - yes - partial} NO of ${scored.length} scored`);
console.log(`APPEARANCE (0-100): mean ${meanAppearance}, distribution ${JSON.stringify(appearances)}`);

const ledger = {
  meta: { at: new Date().toISOString(), generator: GEN.model, judge: JUDGE.model, instructions: rows.length, tier: 'rendered-surface screenshots (visual leg v1)', appearanceRubric: 'v3 - layout/polish only, color exactness separated; 0-100 integer, banded anchors' },
  visual: { backgroundYes: yes, backgroundPartial: partial, backgroundNo: scored.length - yes - partial, scored: scored.length, appearanceScale: 100, meanAppearance },
  pixelCheck: { paintedExact: rows.filter((r) => r.pixelBackground?.painted).length, checked: rows.filter((r) => r.pixelBackground).length },
  rows,
};
const outDir = new URL('../../tools/dev-web-carrier/artifacts/appgen-bench/', import.meta.url);
const outPath = new URL(`../../tools/dev-web-carrier/artifacts/appgen-bench/${LEDGER_STEM}.json`, import.meta.url);
writeFileSync(outPath, JSON.stringify(ledger, null, 2) + '\n');
console.log(`ledger → ${outPath.pathname}`);
