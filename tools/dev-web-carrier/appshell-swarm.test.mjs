// dsh:logging-exempt (node-side driver: console IS the product)
/**
 * appshell-swarm.test.mjs — the swarm-visual leg (scenario appshell.swarm):
 * ONE swarm prompt grows THREE pen-identity variant cards side by side in
 * the strip — closed components render immediately while the not-yet-arrived
 * slots ghost as translucent dashed boxes and each pen cursor rests on its
 * card's growth point. Completion is judged at the L4 bar per card (the
 * card's DOM ≡ its spec's expanded tree, one ash-* element per primitive);
 * promoting a card reuses the SAME openSurface seam; the other two stay
 * selectable; the conversation flow keeps its normal timeline cards (the
 * swarm prompt never replaces them); zero page errors.
 *
 * Every expectation is DERIVED from the very script the carrier's turn
 * machine plays (swarmScriptFor) — never a re-typed copy — including the
 * wire invariant: the staged stream's concatenated argumentsDelta equals
 * the durable tool/call's arguments, byte for byte.
 *
 * Milestones (DSH_SWARM_EVENTS_FILE) land as scenario.jsonl against
 * test/e2e/scenarios/appshell-swarm.json via run-appshell-swarm.sh. The
 * staged PNG shots (DSH_SWARM_SHOTS_DIR) are local visual evidence only —
 * the DOM assertions are the verdict.
 *
 * The carrier-page harness runs under prefers-reduced-motion: reduce, so
 * this leg exercises exactly that posture: no animation, everything still
 * appears instantly (ghosts and cursors included).
 */
import { describe, it, expect, afterAll } from 'vitest';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { openCarriedPage, closeCarriedPage, waitFor, STATES, settleFrame } from '../../test/tools/helpers/carrier-page.mjs';
import { swarmScriptFor } from './next-mode.mjs';
import { validate } from '../../system-plugins/dsh-appshell/lib/validate.js';
import { expandSpec } from '../../presentation/web-client-v2/web/js/appshell-core.js';

const SCENARIO = 'appshell.swarm';
const EVENTS_FILE = process.env.DSH_SWARM_EVENTS_FILE;
const SHOTS_DIR = process.env.DSH_SWARM_SHOTS_DIR;
const milestone = (event, fields = {}) => {
  if (!EVENTS_FILE) return;
  appendFileSync(EVENTS_FILE, JSON.stringify({ scenario: SCENARIO, event, ...fields }) + '\n');
};
const shot = (page, name) => (SHOTS_DIR ? page.screenshot({ path: join(SHOTS_DIR, name + '.png') }) : Promise.resolve());

const PROMPT = '画三个音乐 app 方案';
/** Same selector list as the morph leg: every primitive renders exactly one
 * of these classes (the tabbar is surface chrome; ghosts/cursors/chips are
 * strip chrome namespaced swm-*, never ash-*). */
const DOM_PRIMITIVES = '.ash-text,.ash-image,.ash-btn,.ash-row,.ash-col,.ash-card,.ash-badge,.ash-progress-track';

const countNodes = (n) => 1 + (n.children || []).reduce((sum, c) => sum + countNodes(c), 0);
const rgbOf = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
};

/** The script's OWN variants — the single source every expectation reads.
 * Also pins the wire invariants before the browser enters: the staged
 * chunks concatenate to the durable arguments, and each spec is clean on
 * BOTH validators (plugin + client core, the lockstep contract). */
const scriptOf = () => {
  const script = swarmScriptFor(1, PROMPT, 'swarm-e2e');
  expect(script, 'no carrier script for the swarm prompt').not.toBeNull();
  const deltas = new Map();
  for (const frame of script.stream) {
    if (frame.type === 'chunk' && frame.chunk.type === 'tool-call-delta') {
      deltas.set(frame.chunk.id, (deltas.get(frame.chunk.id) || '') + frame.chunk.argumentsDelta);
    }
  }
  expect(deltas.size, 'the swarm streams three distinct builders').toBe(3);
  const variants = [];
  for (const record of script.settle) {
    if (record.type !== 'tool/call') continue;
    const args = JSON.parse(record.data.arguments);
    expect(deltas.get(record.data.callId), 'staged stream ≡ durable arguments').toBe(record.data.arguments);
    variants.push({ callId: record.data.callId, pen: args.swarm.pen, slots: args.swarm.slots });
  }
  expect(variants).toHaveLength(3);
  const echoes = script.settle.filter((r) => r.type === 'tool/result')
    .map((r) => JSON.parse(r.data.message.content[0].content[0].text));
  return variants.map((variant, i) => {
    const echo = echoes[i];
    expect(echo.ok).toBe(true);
    expect(echo.surfaceId).toMatch(/^dev-swarm-\d+-\d+$/);
    const plugin = validate(echo.spec);
    expect(plugin.ok, JSON.stringify(plugin.errors)).toBe(true);
    const client = expandSpec(echo.spec);
    expect(client.errors, JSON.stringify(client.errors)).toHaveLength(0);
    const count = countNodes(client.screen) - 1;
    expect(countNodes(plugin.expanded) - 1, 'client expander drifted from plugin validator').toBe(count);
    return {
      callId: variant.callId, pen: variant.pen, slots: variant.slots,
      title: echo.title, accent: echo.spec.theme.accent, count,
    };
  });
};

const carried = openCarriedPage();
let page;
const pageErrors = [];
afterAll(async () => {
  if (page && pageErrors.length === 0) {
    expect(pageErrors, 'page errors: ' + pageErrors.join(' | ')).toEqual([]);
    milestone('swarm/page-errors-zero', { errors: 0 });
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

/** The probe holds until a GENUINE mid-generation state: three cards, ghosts
 * on the board, all three pens resting. The assertions pin the deterministic
 * fields (identity); the exact ghost count at sample time is timing, by
 * design — ghostsSeen records that the ghost state was really observed. */
const growingProbe = (page) => page.evaluate((selector) => {
  const strip = document.getElementById('swarm-strip');
  if (strip.hidden) return null;
  const cards = [...strip.querySelectorAll('.swm-card')];
  if (cards.length !== 3) return null;
  const ghosts = cards.reduce((n, c) => n + c.querySelectorAll('.swm-ghost').length, 0);
  const cursors = cards.filter((c) => c.querySelector('.swm-cursor')?.hidden === false).length;
  if (ghosts === 0 || cursors !== 3) return null;
  return {
    pens: cards.map((c) => c.querySelector('.swm-pen-name')?.textContent ?? ''),
    accents: cards.map((c) => c.style.getPropertyValue('--swm-accent')),
  };
}, DOM_PRIMITIVES);

const growingLeg = async (page) => {
  const expected = scriptOf();
  await waitTurnSettled();
  await sendPrompt(PROMPT);
  milestone('swarm/turn-submitted', { input: PROMPT });
  const growing = await waitFor(
    () => growingProbe(page),
    'the strip mid-generation (3 cards, ghosts visible, 3 pens resting)',
  );
  expect(growing.pens).toEqual(expected.map((v) => v.pen));
  expect(growing.accents).toEqual(expected.map((v) => v.accent));
  expect(new Set(growing.accents).size).toBe(3);
  await shot(page, 'generating-with-ghosts');
  milestone('swarm/strip-growing', { cards: 3, ghostsSeen: true, cursors: 3 });
  milestone('swarm/pen-identity', { pens: growing.pens.join('|'), accents: 3 });
};

const completeLeg = async (page) => {
  const expected = scriptOf();
  const done = await waitFor(
    () => page.evaluate((selector) => {
      const strip = document.getElementById('swarm-strip');
      if (strip.hidden) return null;
      const cards = [...strip.querySelectorAll('.swm-card')];
      if (cards.length !== 3) return null;
      if (cards.some((c) => c.querySelectorAll('.swm-ghost').length > 0)) return null;
      if (!cards.every((c) => c.querySelector('.swm-chip')?.textContent === '完成')) return null;
      return cards.map((c) => c.querySelector('.swm-body')?.querySelectorAll(selector).length ?? -1);
    }, DOM_PRIMITIVES),
    'the three cards complete and ghost-free',
  );
  for (const [i, variant] of expected.entries()) {
    expect(done[i], `card DOM primitives for ${variant.pen}`).toBe(variant.count);
    milestone('swarm/card-parity', { pen: variant.pen, expected: variant.count, actual: done[i] });
  }
  const flow = await page.evaluate((titles) => ({
    promptIntact: [...document.querySelectorAll('.user-bubble')]
      .some((b) => b.textContent.includes('画三个音乐')),
    toolCards: [...document.querySelectorAll('.appshell-tool-row')]
      .filter((r) => titles.some((t) => r.textContent.includes(t))).length,
  }), expected.map((v) => v.title));
  expect(flow.promptIntact).toBe(true);
  expect(flow.toolCards).toBe(3);
  await shot(page, 'all-three-complete');
  milestone('swarm/all-complete', { cards: 3, ghosts: 0 });
  milestone('swarm/timeline-intact', { promptIntact: true, toolCards: 3 });
};

const reselectLeg = async (page) => {
  const [first] = scriptOf();
  const reselected = await waitFor(
    () => page.evaluate((accent) => {
      const cards = [...document.querySelectorAll('#swarm-strip .swm-card')];
      if (cards.length !== 3) return null;
      cards[0].click();
      const view = document.getElementById('appshell-view');
      if (view?.hidden !== false) return null;
      return getComputedStyle(view.querySelector('.creation-header')).backgroundColor.includes(accent);
    }, rgbOf(first.accent)),
    'the FIRST card also promotes (the un-promoted variants stay selectable)',
  );
  expect(reselected).toBe(true);
  milestone('swarm/others-selectable', { reselected: first.pen, cardsRemaining: 3 });
  await page.click('#appshell-close');
  await waitFor(
    () => page.evaluate(() => document.getElementById('appshell-view')?.hidden === true
      && document.getElementById('swarm-strip')?.hidden === false),
    'the surface closed with the strip still holding all three cards',
  );
  milestone('swarm/surface-closed', {});
};

const promoteLeg = async (page) => {
  const [, second] = scriptOf();
  await page.evaluate(() => {
    [...document.querySelectorAll('#swarm-strip .swm-card')][1].click(); // the second pen
  });
  const promoted = await waitFor(
    () => page.evaluate((accent) => {
      const view = document.getElementById('appshell-view');
      if (view?.hidden !== false) return null;
      const header = getComputedStyle(view.querySelector('.creation-header'));
      const cards = [...document.querySelectorAll('#swarm-strip .swm-card')];
      return header.backgroundColor.includes(accent) && cards.length === 3
        && cards[1].classList.contains('swm-card--selected') ? true : null;
    }, rgbOf(second.accent)),
    'the promoted fullscreen surface with its own accent + selected card',
  );
  expect(promoted).toBe(true);
  const surfaceCount = await page.evaluate(
    (sel) => document.getElementById('appshell-root').querySelectorAll(sel).length, DOM_PRIMITIVES);
  expect(surfaceCount, 'surface DOM ≡ the promoted spec expanded tree').toBe(second.count);
  await settleFrame(page);
  await shot(page, 'promoted-fullscreen');
  milestone('swarm/promoted-fullscreen', { pen: second.pen, accent: second.accent });
  milestone('swarm/surface-parity', { expected: second.count, actual: surfaceCount });
  await page.click('#appshell-close');
  await waitFor(
    () => page.evaluate(() => document.getElementById('appshell-view')?.hidden === true),
    'the promoted surface closed',
  );
  await reselectLeg(page);
};

describe('the swarm visual on the dev carrier', () => {
  it('boots, closes first-run onboarding, and opens the fixture session', async () => {
    const env = await carried;
    page = env.page;
    page.on('pageerror', (err) => pageErrors.push(String(err)));
    if (SHOTS_DIR) mkdirSync(SHOTS_DIR, { recursive: true });
    await STATES.home.drive(page);
    await STATES.session.drive(page);
    milestone('swarm/boot', { client: 'web-client-v2', viewport: '390x844@2x' });
  });

  it('one swarm prompt grows three pen cards with ghost slots and resting cursors', () => growingLeg(page));

  it('all three complete ghost-free; each card DOM ≡ its spec expanded tree', () => completeLeg(page));

  it('promoting one card reuses openSurface at its own accent; the others stay selectable', () => promoteLeg(page));
});
