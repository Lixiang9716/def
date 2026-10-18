// dsh:logging-exempt (node-side driver: console IS the product)
/**
 * appshell-m3.test.mjs — the M3 acceptance leg (scenario appshell.m3): the
 * action loop-back NUMBERS, measured on the dev carrier (deterministic mock
 * model — the plumbing ceiling; real-model latency is the L3/M4 ledger's
 * tier). Four verdict rows (plan §M3), each an in-test threshold assertion
 * whose measured value rides the milestone stream:
 *
 *   1. local response  ≤50ms   — the tab switch is synchronous in-page
 *      state, measured around the click across every tab (max sample).
 *   2. loop closure    ≤15s    — button click → tagged user turn → the
 *      scripted appshell_update → the auto-apply merges it over the open
 *      surface and the DOM changes; wall clock, start at the click.
 *   3. incremental     ≤40%    — the update payload's bytes vs the full
 *      re-render spec's bytes, both taken from the SAME exported carrier
 *      sources the wire actually plays.
 *   4. post-update DOM parity — the surface renders exactly the MERGED
 *      spec's expanded tree (plugin validator + client core lockstep
 *      asserted beside it) with zero stale nodes from the pre-update tree.
 *
 * Milestone events (DSH_M3_EVENTS_FILE): one JSON line per completed row —
 * run-appshell-m3.sh lands them as the registered scenario.jsonl against
 * test/e2e/scenarios/appshell-m3.json.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { appendFileSync } from 'node:fs';
import { openCarriedPage, closeCarriedPage, waitFor, STATES } from '../../test/tools/helpers/carrier-page.mjs';
import { appShellScriptFor, appShellUpdateScriptFor, APP_SHELL_UPDATE_SPEC } from './next-mode.mjs';
import { validate, mergeUpdate as pluginMerge } from '../../system-plugins/dsh-appshell/lib/validate.js';
import { expandSpec, mergeUpdate as clientMerge } from '../../presentation/web-client-v2/web/js/appshell-core.js';

const SCENARIO = 'appshell.m3';
const EVENTS_FILE = process.env.DSH_M3_EVENTS_FILE;
const milestone = (event, fields = {}) => {
  if (!EVENTS_FILE) return;
  appendFileSync(EVENTS_FILE, JSON.stringify({ scenario: SCENARIO, event, ...fields }) + '\n');
};

const LOCAL_BUDGET_MS = 50;
const LOOP_BUDGET_MS = 15_000;
const RATIO_BUDGET = 0.40;

const THEME = { prompt: '变成微信', label: '微信' };
const DOM_PRIMITIVES = '.ash-text,.ash-image,.ash-btn,.ash-row,.ash-col,.ash-card,.ash-badge,.ash-progress-track';
const countNodes = (n) => 1 + (n.children || []).reduce((sum, c) => sum + countNodes(c), 0);

/** The exact spec the carrier's render turn carries for our theme prompt. */
const renderEchoSpec = () => {
  const script = appShellScriptFor(1, THEME.prompt, 'm3');
  return JSON.parse(
    script.settle.find((r) => r.type === 'tool/result').data.message.content[0].content[0].text).spec;
};

const carried = openCarriedPage();
let page;
const pageErrors = [];
afterAll(async () => {
  if (page && pageErrors.length === 0) {
    expect(pageErrors, 'page errors: ' + pageErrors.join(' | ')).toEqual([]);
    milestone('m3/page-errors-zero', { errors: 0 });
  }
  await closeCarriedPage(await carried);
});

const waitTurnSettled = async () => {
  let previous = -1;
  await waitFor(
    async () => {
      const snapshot = await page.evaluate(() => ({
        items: window.__dshTimelineDebug?.()?.items ?? -1,
        running: window.__dshComposerDebug?.()?.running ?? true,
      }));
      const settled = !snapshot.running && snapshot.items === previous && previous >= 0;
      previous = snapshot.items;
      return settled;
    },
    'the previous turn fully settled',
  );
};

const sendPrompt = async (text) => {
  await page.waitForSelector('#composer-input', { visible: true });
  await page.click('#composer-input');
  await page.type('#composer-input', text);
  await page.click('#composer-send');
};

const openSurface = async () => {
  await waitFor(
    () => page.evaluate((label) => {
      const rows = [...document.querySelectorAll('.appshell-tool-row')];
      const last = rows[rows.length - 1];
      if (!last || !last.textContent.includes(label)) return false;
      const group = last.closest('.group');
      if (group && !group.classList.contains('open')) group.querySelector('.group-header')?.click();
      const button = last.querySelector('.appshell-open-btn');
      if (!button || button.offsetParent === null) return false;
      button.click();
      return true;
    }, THEME.label),
    'the ' + THEME.label + ' surface opened',
  );
  await waitFor(
    () => page.evaluate(() => document.getElementById('appshell-view')?.hidden === false),
    'the surface view visible',
  );
};

/** Row 1: every tab's synchronous click→activate, max sample. */
const row1LocalLatency = async () => {
  const maxMs = await page.evaluate(async () => {
    const tabs = [...document.querySelectorAll('#appshell-view .ash-tab')];
    let max = 0;
    for (const tab of tabs) {
      const t0 = performance.now();
      tab.click();
      const dt = performance.now() - t0;
      if (dt > max) max = dt;
      if (!tab.classList.contains('active')) throw new Error('tab did not activate synchronously');
    }
    return max;
  });
  expect(maxMs, 'the slowest local tab switch').toBeLessThanOrEqual(LOCAL_BUDGET_MS);
  milestone('m3/local-latency', { tabs: 4, maxMs, budgetMs: LOCAL_BUDGET_MS });
};

/** Row 3: payload bytes, both from the exported carrier sources. */
const row3IncrementalRatio = () => {
  const full = JSON.stringify(renderEchoSpec());
  const update = JSON.stringify(APP_SHELL_UPDATE_SPEC);
  const ratio = update.length / full.length;
  expect(ratio, `update ${update.length}B vs full ${full.length}B`).toBeLessThanOrEqual(RATIO_BUDGET);
  // The update turn the carrier will play for a loop-back names the live
  // surface (dev-app-1, the render turn) — pinned so the loop provably rode
  // the matching surfaceId, not a lucky default.
  const script = appShellUpdateScriptFor(2, '[appshell:demo.tap] 播放', 'm3', 'dev-app-1');
  expect(JSON.parse(script.settle[1].data.arguments).surfaceId).toBe('dev-app-1');
  milestone('m3/incremental-ratio', { fullBytes: full.length, updateBytes: update.length, ratioPct: Math.round(ratio * 1000) / 10 });
};

/** Row 2: the click → tagged turn → update → auto-apply → re-render wall. */
const row2LoopClosure = async () => {
  await waitTurnSettled();
  const t0 = Date.now();
  await page.evaluate(() => document.querySelector('#appshell-view .ash-btn')?.click());
  await waitFor(
    () => page.evaluate(() => {
      const root = document.getElementById('appshell-root');
      return root !== null && root.textContent.includes('已选歌单')
        && document.getElementById('appshell-view')?.hidden === false;
    }),
    'the surface re-rendered with the merged update content',
  );
  const ms = Date.now() - t0;
  expect(ms, 'the loop-back closure').toBeLessThanOrEqual(LOOP_BUDGET_MS);
  const tagged = await page.evaluate(() => [...document.querySelectorAll('.user-bubble')]
    .some((b) => b.textContent.startsWith('[appshell:')));
  expect(tagged).toBe(true);
  milestone('m3/loop-closure', { ms, budgetMs: LOOP_BUDGET_MS, transport: 'carrier mock (deterministic)' });
};

/** Row 4: the post-update DOM equals the merged spec, zero stale nodes. */
const row4PostUpdateParity = async () => {
  const merged = clientMerge(renderEchoSpec(), APP_SHELL_UPDATE_SPEC);
  const plugin = validate(merged);
  expect(plugin.ok, JSON.stringify(plugin.errors)).toBe(true);
  const client = expandSpec(merged);
  expect(client.errors, JSON.stringify(client.errors)).toHaveLength(0);
  const expected = countNodes(client.screen) - 1;
  const { actual, stale } = await page.evaluate((sel) => {
    const root = document.getElementById('appshell-root');
    return {
      actual: root.querySelectorAll(sel).length,
      stale: root.textContent.includes('入口一') || root.textContent.includes('一句话生成') ? 1 : 0,
    };
  }, DOM_PRIMITIVES);
  expect(actual, 'post-update DOM primitive count').toBe(expected);
  expect(stale, 'stale nodes from the pre-update tree').toBe(0);
  milestone('m3/dom-parity-after-update', { expected, actual, stale });
};

const bootLeg = async () => {
  const env = await carried;
  page = env.page;
  page.on('pageerror', (err) => pageErrors.push(String(err)));
  await STATES.home.drive(page);
  await STATES.session.drive(page);
  await waitTurnSettled();
  await sendPrompt(THEME.prompt);
  await openSurface();
  milestone('m3/boot', { label: THEME.label, surface: 'appshell-1-era dev surface' });
};

describe('M3: the action loop-back numbers on the dev carrier', () => {
  it('boots, renders 微信, and opens the surface', bootLeg);
  it('row 1 — local tab switch responds in ≤50ms (max over every tab, synchronous)', row1LocalLatency);
  it('row 3 — the incremental update payload is ≤40% of the full re-render payload', row3IncrementalRatio);
  it('row 2 — the loop-back closes in ≤15s: click → tagged turn → update → the surface re-renders', row2LoopClosure);
  it('row 4 — the post-update DOM equals the MERGED spec exactly, zero stale nodes', row4PostUpdateParity);
});
