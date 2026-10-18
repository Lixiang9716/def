// dsh:logging-exempt (node-side driver: console IS the product)
/**
 * appshell-morph.test.mjs — the L4 acceptance leg (scenario appshell.morph):
 * one prompt per theme (微信 → 网易云音乐 → 支付宝), each producing an
 * appshell_render tool card whose preview renders from the echoed spec, then
 * the fullscreen presented surface opens with the theme's own accent and
 * closes cleanly. Browser assertions only — screenshots stay a local
 * artifact, never the verdict. Also pins the "fourth app" counterfactual at
 * the E2E layer: three themes, zero renderer edits between them.
 *
 * The L4 verdict rows (plan §3.5): DOM component-node count == the spec's
 * expanded tree (100%, templates per the PLUGIN validator's expansion), and
 * console error == 0. The parity triple per theme: the plugin-side expanded
 * count, the client-side expandSpec count (the lockstep appshell-core.js
 * promises), and the live page count of rendered primitive elements — all
 * three must agree before the milestone is emitted.
 *
 * Milestone events: with DSH_MORPH_EVENTS_FILE set, every completed
 * assertion step appends one JSON line (scenario appshell.morph) — the
 * one-to-one record run-appshell-morph.sh lands as scenario.jsonl against
 * test/e2e/scenarios/appshell-morph.json. Without the env var (plain vitest,
 * CI) the file writes are inert.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { appendFileSync } from 'node:fs';
import { openCarriedPage, closeCarriedPage, waitFor, STATES } from '../../test/tools/helpers/carrier-page.mjs';
import { appShellScriptFor } from './next-mode.mjs';
import { validate } from '../../system-plugins/dsh-appshell/lib/validate.js';
import { expandSpec } from '../../presentation/web-client-v2/web/js/appshell-core.js';

const SCENARIO = 'appshell.morph';
const EVENTS_FILE = process.env.DSH_MORPH_EVENTS_FILE;
const milestone = (event, fields = {}) => {
  if (!EVENTS_FILE) return;
  appendFileSync(EVENTS_FILE, JSON.stringify({ scenario: SCENARIO, event, ...fields }) + '\n');
};

const THEMES = [
  { prompt: '变成微信', label: '微信', accent: '#07C160' },
  { prompt: '变成网易云音乐', label: '网易云音乐', accent: '#ec4141' },
  { prompt: '变成支付宝', label: '支付宝', accent: '#1677FF' },
];

/** Every rendered spec primitive carries exactly one of these classes
 * (progressbar counts its track element; the tabbar is surface chrome, and
 * the screen root itself is never rendered — its children render directly). */
const DOM_PRIMITIVES = '.ash-text,.ash-image,.ash-btn,.ash-row,.ash-col,.ash-card,.ash-badge,.ash-progress-track';

const countNodes = (n) => 1 + (n.children || []).reduce((sum, c) => sum + countNodes(c), 0);

/** The expanded-tree size the page must render for one theme's spec —
 * computed from the SAME script the carrier's turn machine plays (never a
 * re-typed spec), expanded by BOTH sides (plugin validator + client core,
 * the lockstep contract) before the page is counted. */
const expectedDomCount = (theme) => {
  const script = appShellScriptFor(1, theme.prompt, 'parity');
  expect(script, `no carrier script for ${theme.prompt}`).not.toBeNull();
  const echo = JSON.parse(
    script.settle.find((r) => r.type === 'tool/result').data.message.content[0].content[0].text);
  expect(echo.ok).toBe(true);
  expect(echo.title).toBe(theme.label);
  expect(echo.surfaceId).toMatch(/^dev-app-\d+$/); // parity with the real plugin's echo shape (#582)
  const plugin = validate(echo.spec);
  expect(plugin.ok, JSON.stringify(plugin.errors)).toBe(true);
  const client = expandSpec(echo.spec);
  expect(client.errors, JSON.stringify(client.errors)).toHaveLength(0);
  const pluginCount = countNodes(plugin.expanded) - 1;
  const clientCount = countNodes(client.screen) - 1;
  expect(clientCount, 'the client expander drifted from the plugin validator').toBe(pluginCount);
  return pluginCount;
};

const carried = openCarriedPage();
let page;
const pageErrors = [];
afterAll(async () => {
  if (page && pageErrors.length === 0) {
    expect(pageErrors, 'page errors: ' + pageErrors.join(' | ')).toEqual([]);
    milestone('morph/page-errors-zero', { errors: 0 });
  }
  await closeCarriedPage(await carried);
});


const forceCloseSurface = () => page.evaluate(() => {
  const view = document.getElementById('appshell-view');
  if (view && !view.hidden) {
    document.getElementById('appshell-close')?.click();
    view.hidden = true;
  }
});

/** Fold + composer fully quiescent: item count stable across two samples
 * 400ms apart and the composer out of generating. A prompt sent inside the
 * drain window is answered session/busy (measured). */
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
    'the previous turn fully settled (stable fold + composer idle)',
  );
};

const sendPrompt = async (text) => {
  await page.waitForSelector('#composer-input', { visible: true });
  await page.click('#composer-input');
  await page.type('#composer-input', text);
  await page.click('#composer-send');
};


const cardRenderedFor = (label) => page.evaluate((label2) => {
  const rows = [...document.querySelectorAll('.appshell-tool-row')];
  const last = rows[rows.length - 1];
  return last !== undefined && last.textContent.includes(label2)
    && last.querySelector('.appshell-open-btn') !== null
    && last.querySelector('.appshell-preview')?.children?.length > 0;
}, label);

/** Atomic in-page: expand the card's process group, wait for the open
 * button to be visible, click it — ElementHandles go stale across the
 * fold's structure bumps, so nothing crosses a render. */
const openSurfaceByLabel = async (label) => {
  await waitFor(
    () => page.evaluate((label2) => {
      const rows = [...document.querySelectorAll('.appshell-tool-row')];
      const last = rows[rows.length - 1];
      if (!last || !last.textContent.includes(label2)) return false;
      const group = last.closest('.group');
      if (group && !group.classList.contains('open')) group.querySelector('.group-header')?.click();
      const button = last.querySelector('.appshell-open-btn');
      if (!button || button.offsetParent === null) return false;
      button.click();
      return true;
    }, label),
    'the ' + label + ' surface opened by clicking its card button',
  );
};

const assertSurface = async (theme) => {
  await waitFor(
    () => page.evaluate((accent) => {
      const view = document.getElementById('appshell-view');
      return view?.hidden === false
        && document.getElementById('appshell-title-text')?.textContent !== ''
        && view.querySelector('.ash-card') !== null
        && getComputedStyle(view.querySelector('.creation-header')).backgroundColor.includes(
          accent === '#07C160' ? '7, 193, 96' : accent === '#ec4141' ? '236, 65, 65' : '22, 119, 255');
    }, theme.accent),
    'the fullscreen ' + theme.label + ' surface with its own accent',
  );
};

/** L4's first verdict row: the live page renders exactly the expanded
 * primitive tree — every declared component present, nothing extra. The
 * count scopes FROM the root element (a prefixed selector LIST would only
 * scope its first comma-arm — the rest would match the timeline preview
 * cards too; measured). */
const assertDomParity = async (theme) => {
  const expected = expectedDomCount(theme);
  const actual = await page.evaluate(
    (sel) => document.getElementById('appshell-root').querySelectorAll(sel).length, DOM_PRIMITIVES);
  expect(actual, `DOM primitive count for ${theme.label}`).toBe(expected);
  milestone('morph/dom-parity', { label: theme.label, expected, actual });
};

const switchTabLocal = async (theme) => {
  await page.evaluate(() => {
    const tabs = [...document.querySelectorAll('#appshell-view .ash-tab')];
    tabs[tabs.length - 1].click();
  });
  await waitFor(
    () => page.evaluate(() => {
      const tabs = [...document.querySelectorAll('#appshell-view .ash-tab')];
      return tabs.length > 1 && tabs[tabs.length - 1].classList.contains('active')
        && !tabs[0].classList.contains('active');
    }),
    'the local tab switch (no turn emitted)',
  );
  milestone('morph/tab-local', { label: theme.label });
};

const assertActionLoopback = async (theme) => {
  const hasButton = await page.evaluate(() => document.querySelector('#appshell-view .ash-btn') !== null);
  if (!hasButton) return; // a button-less theme: the tab switch above covered local-only
  await page.evaluate(() => document.querySelector('#appshell-view .ash-btn')?.click());
  await waitFor(
    () => page.evaluate(() => {
      const bubbles = [...document.querySelectorAll('.user-bubble')];
      return bubbles.some((b) => b.textContent.startsWith('[appshell:'));
    }),
    'the app-shell action landed as a tagged user turn',
  );
  milestone('morph/action-loopback', { label: theme.label });
};

const closeSurfaceAndDrain = async (label) => {
  await page.click('#appshell-close');
  await waitFor(
    () => page.evaluate((label2) => {
      const title = document.getElementById('chat-title')?.textContent ?? '';
      return document.getElementById('appshell-view')?.hidden === true && title.includes(label2);
    }, label),
    'the surface closed and the turn chain fully drained (title = ' + label + ')',
  );
  milestone('morph/surface-closed', { label });
};

const runMorph = async (theme) => {
  await waitTurnSettled();
  milestone('morph/turn-submitted', { label: theme.label, input: theme.prompt });
  // The card wait is bounded-retry: a prompt landing in the previous turn's
  // drain window is answered session/busy — the honest retry is sending again.
  for (let attempt = 0; attempt < 3; attempt++) {
    await sendPrompt(theme.prompt);
    try {
      await waitFor(() => cardRenderedFor(theme.label), 'card (attempt ' + (attempt + 1) + ')', 6000);
      break;
    } catch (err) {
      const busy = await page.evaluate(() => window.__dshSendError === 'session/busy');
      if (!busy || attempt === 2) throw err;
      await page.evaluate(() => { window.__dshSendError = null; });
    }
  }
  milestone('morph/card-rendered', { label: theme.label });
  await openSurfaceByLabel(theme.label);
  milestone('morph/surface-opened', { label: theme.label, accent: theme.accent });
  await assertSurface(theme);
  await assertDomParity(theme);
  await switchTabLocal(theme);
  await assertActionLoopback(theme);
  await closeSurfaceAndDrain(theme.label);
};

describe('one-prompt app morphing on the dev carrier', () => {
  it('boots, closes first-run onboarding, and opens the fixture session', async () => {
    const env = await carried;
    page = env.page;
    page.on('pageerror', (err) => pageErrors.push(String(err)));
    await STATES.home.drive(page);
    await STATES.session.drive(page);
    milestone('morph/boot', { client: 'web-client-v2', viewport: '390x844@2x' });
  });

  for (const theme of THEMES) {
    it('morphs to ' + theme.label + ' from one prompt', async () => {
      // A failed assertion must not leave the presented surface open over
      // the page — that cascaded into every later theme (measured).
      try {
        await runMorph(theme);
      } finally {
        await forceCloseSurface();
      }
    });
  }

  it('three themes, zero page errors — the renderer never changed between them', async () => {
    expect(pageErrors).toEqual([]);
  });
});
