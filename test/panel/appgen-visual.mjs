/**
 * appgen-visual: the visual leg — the design-constitution half the static
 * judge cannot see. Generate a spec, run it through the product's own
 * validate() (visual leg v2: a spec the product would refuse is recorded
 * as refused, never rendered; the minted form — near-miss theme colors
 * snapped to the exact hex, exactly what appshell_render renders — is
 * what renders), screenshot the presented surface in the real web client
 * (the dev carrier page + openSurface), and ask a VISION judge what the
 * static tier could never know: is the requested background actually
 * painted, are the named colors visible, and how does it look (the
 * appearance score; rubric v3 grades 0-100 — v2's 1-5 saturated at 4
 * every round, hiding polish progress). A dark-scheme audit samples the
 * SAME minted specs re-rendered with theme.mode=dark (VISUAL_DARK_N):
 * identical content, only the scheme differs — the pixel luminance check
 * owns the dark assertion (the stage must go nocturnal), the judge
 * re-grades polish only.
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
// The product's four-gate validator — the same module appshell_render runs
// (system-plugins/dsh-appshell/index.js) and the panel tests import.
import { validate } from '../../system-plugins/dsh-appshell/lib/validate.js';

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
const VISUAL_N = Number(process.env.VISUAL_N || 12);
const DARK_N = Number(process.env.VISUAL_DARK_N || 2);
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

/** Slots the validator snapped, as {slot: [rawHex, mintedHex]} — null when
 * none did. The ledger's adherence evidence: the pixel check measures the
 * rendered surface against the minted hex, not the raw request. */
/** Grid-mean relative luminance (0-1) — the dark-constitution assertion:
 * the nocturnal stage (#101014, app.css dark block) sits ~0.06; a white
 * or flash render lands far above. */
const meanLuminance = (shot) => {
  const png = readPng(shot);
  let sum = 0, n = 0;
  for (let y = 8; y < png.height - 8; y += 24) {
    for (let x = 8; x < png.width - 8; x += 24) {
      const i = (y * png.width + x) * 4;
      sum += (0.2126 * png.data[i] + 0.7152 * png.data[i + 1] + 0.0722 * png.data[i + 2]) / 255;
      n += 1;
    }
  }
  return n ? Math.round(sum / n * 1000) / 1000 : 1;
};

const colorSnaps = (raw, mintedSpec) => {
  const snaps = {};
  for (const slot of ['accent', 'background']) {
    if (raw.theme?.[slot] !== undefined && raw.theme[slot] !== mintedSpec.theme?.[slot]) {
      snaps[slot] = [raw.theme[slot], mintedSpec.theme[slot]];
    }
  }
  return Object.keys(snaps).length ? snaps : null;
};

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
const rendered = []; // { row, instruction, minted } — the dark-audit sample pool
try {
  for (const instruction of corpus) {
    const row = { source_id: instruction.source_id };
    try {
      const spec = await generate(instruction.prompt);
      row.theme = spec.theme ?? null;
      // Product-faithful render path (appshell_render): validate first —
      // a spec the product would refuse is recorded as refused, never
      // rendered; the minted form (near-miss theme colors snapped to the
      // exact hex) is what renders and what the pixel check measures
      // adherence against, so the snap is verified at the pixel layer.
      const check = validate(spec);
      row.validated = check.ok;
      let minted = null;
      if (!check.ok) {
        row.rejectCodes = check.errors.map((e) => e.code);
        row.opened = false;
      } else {
        minted = check.normalizedSpec ?? spec;
        row.colorSnap = check.normalizedSpec ? colorSnaps(spec, minted) : null;
        const opened = await session.page.evaluate(async (spec) => {
          const mod = await import(new URL('js/appshell.js', location.href).href);
          const ok = mod.openSurface({ title: 'App', spec, onAction: null });
          await new Promise((r) => setTimeout(r, 350));
          return ok;
        }, minted);
        row.opened = opened === true;
        const view = await session.page.$('#appshell-view');
        const shot = await view.screenshot({ type: 'png' });
        const shotPath = new URL(`${instruction.source_id}.png`, shotsDir);
        writeFileSync(shotPath, shot);
        row.shot = shotPath.pathname.split('/').slice(-2).join('/');
        rendered.push({ row, instruction, minted });
        // The pixel check owns exactness: grid-sample the shot — the
        // background is painted when a large fraction of the surface is
        // within tolerance of the exact MINTED hex (headers/cards may
        // differ). The snap is verified here: the rendered pixels must
        // adhere to the normalized hex, not the raw request.
        row.pixelBackground = null;
        if (typeof minted.theme?.background === 'string' && /^#[0-9a-fA-F]{6}$/.test(minted.theme.background)) {
          const { fraction } = backgroundHitFraction(shot, minted.theme.background);
          row.pixelBackground = { target: minted.theme.background, hitFraction: fraction, painted: fraction >= 0.25 };
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
      }
    } catch (e) {
      row.error = e.message.slice(0, 160);
    }
    rows.push(row);
    if (row.validated === false) {
      console.log(`${instruction.source_id}: REJECTED(${row.rejectCodes.join(',')}) | not rendered — product gates refuse this spec`);
    } else {
      console.log(`${instruction.source_id}: bg ${row.background_painted ?? (row.judge_failed ? 'JUDGE-FAIL' : 'ERR')} | pixel ${row.pixelBackground ? (row.pixelBackground.painted ? 'EXACT' : 'OFF(' + row.pixelBackground.distance + ')') : '-'} | appearance ${row.appearance ?? '-'} | ${(row.colors_visible || row.why || row.error || '').slice(0, 60)}`);
    }
  }
  // Dark-scheme audit: re-render a sample of the SAME minted specs with
  // theme.mode flipped to dark — identical content, only the scheme
  // differs (the controlled test of the dark constitution). The pixel
  // luminance check owns the dark assertion (the stage must go nocturnal,
  // app.css #101014); the judge re-grades polish only — background_painted
  // is not recorded for dark rows because the mode flip legitimately
  // replaces the requested light hex and the channel would read NO by
  // construction.
  const darkJobs = rendered.slice(0, DARK_N);
  if (darkJobs.length) {
    await session.page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
    for (const job of darkJobs) {
      const dark = {};
      try {
        const spec = JSON.parse(JSON.stringify(job.minted));
        spec.theme = { ...spec.theme, mode: 'dark' };
        const opened = await session.page.evaluate(async (spec) => {
          const mod = await import(new URL('js/appshell.js', location.href).href);
          const ok = mod.openSurface({ title: 'App', spec, onAction: null });
          await new Promise((r) => setTimeout(r, 350));
          return ok;
        }, spec);
        dark.opened = opened === true;
        const view = await session.page.$('#appshell-view');
        const shot = await view.screenshot({ type: 'png' });
        const shotPath = new URL(`${job.instruction.source_id}.dark.png`, shotsDir);
        writeFileSync(shotPath, shot);
        dark.shot = shotPath.pathname.split('/').slice(-2).join('/');
        dark.meanLuminance = meanLuminance(shot);
        dark.dark = dark.meanLuminance < 0.35;
        const verdict = await judgeVisual(job.instruction, shot.toString('base64'));
        if (verdict === null) dark.judge_failed = true;
        else { dark.appearance = verdict.appearance; dark.why = verdict.why; dark.colors_visible = verdict.colors_visible; }
      } catch (e) {
        dark.error = e.message.slice(0, 160);
      }
      job.row.dark = dark;
      console.log(`dark ${job.instruction.source_id}: ${dark.dark ? 'DARK' : 'NOT-DARK'} lum ${dark.meanLuminance} | appearance ${dark.appearance ?? (dark.judge_failed ? 'JUDGE-FAIL' : '-')} | ${(dark.why || dark.error || '').slice(0, 60)}`);
    }
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
const refused = rows.filter((r) => r.validated === false).length;
console.log(`VALIDATOR (product gates): ${refused} refused of ${rows.length}`);
console.log(`APPEARANCE (0-100): mean ${meanAppearance}, distribution ${JSON.stringify(appearances)}`);
const darkRows = rows.filter((r) => r.dark);
const darkOk = darkRows.filter((r) => r.dark.dark).length;
const darkLums = darkRows.map((r) => r.dark.meanLuminance).filter((v) => v !== undefined).sort((a, b) => a - b);
const darkApps = darkRows.map((r) => r.dark.appearance).filter((v) => v !== undefined);
const darkMeanLum = darkLums.length ? Math.round(darkLums.reduce((a, b) => a + b, 0) / darkLums.length * 1000) / 1000 : null;
const darkMeanApp = darkApps.length ? Math.round(darkApps.reduce((a, b) => a + b, 0) * 10 / darkApps.length) / 10 : null;
console.log(`DARK SAMPLE: ${darkOk}/${darkRows.length} went dark, mean luminance ${darkMeanLum}, mean appearance ${darkMeanApp}`);

const ledger = {
  meta: { at: new Date().toISOString(), generator: GEN.model, judge: JUDGE.model, instructions: rows.length, tier: 'rendered-surface screenshots (visual leg v2, product validate+normalize render path)', appearanceRubric: 'v3 - layout/polish only, color exactness separated; 0-100 integer, banded anchors', darkAudit: `sampled re-render with theme.mode=dark on the same minted specs (VISUAL_DARK_N=${DARK_N}); luminance <0.35 = dark` },
  visual: { backgroundYes: yes, backgroundPartial: partial, backgroundNo: scored.length - yes - partial, scored: scored.length, rejected: refused, appearanceScale: 100, meanAppearance, darkSampled: darkRows.length, darkOk, darkMeanLuminance: darkMeanLum, darkMeanAppearance: darkMeanApp },
  pixelCheck: { paintedExact: rows.filter((r) => r.pixelBackground?.painted).length, checked: rows.filter((r) => r.pixelBackground).length },
  rows,
};
const outDir = new URL('../../tools/dev-web-carrier/artifacts/appgen-bench/', import.meta.url);
const outPath = new URL(`../../tools/dev-web-carrier/artifacts/appgen-bench/${LEDGER_STEM}.json`, import.meta.url);
writeFileSync(outPath, JSON.stringify(ledger, null, 2) + '\n');
console.log(`ledger → ${outPath.pathname}`);
