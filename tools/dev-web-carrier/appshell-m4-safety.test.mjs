// dsh:logging-exempt (node-side driver: console IS the product)
/**
 * appshell-m4-safety.test.mjs — the M4 text-safety row (scenario
 * appshell.m4): fields containing `<`, `"`, and `onerror=` render 100% as
 * LITERAL TEXT through the whole carrier stack (tool card preview AND the
 * fullscreen surface), with zero executable structure — no script/img
 * elements, no on* attributes, no page errors.
 *
 * The hostile fixture lives carrier-side (APP_SHELL_HOSTILE_TEXTS in
 * next-mode.mjs): the validator PASSES it on purpose (plain strings are
 * legal text — purity is the gate, not censorship), so the assertion under
 * test is the rendering chain, exactly what a hostile payload would ride.
 *
 * Milestone events (DSH_M4_EVENTS_FILE) land as the registered
 * scenario.jsonl against test/e2e/scenarios/appshell-m4.json via
 * run-appshell-m4.sh.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { appendFileSync } from 'node:fs';
import { openCarriedPage, closeCarriedPage, waitFor, STATES } from '../../test/tools/helpers/carrier-page.mjs';
import { appShellScriptFor, APP_SHELL_HOSTILE_TEXTS } from './next-mode.mjs';
import { validate } from '../../system-plugins/dsh-appshell/lib/validate.js';

const SCENARIO = 'appshell.m4';
const EVENTS_FILE = process.env.DSH_M4_EVENTS_FILE;
const milestone = (event, fields = {}) => {
  if (!EVENTS_FILE) return;
  appendFileSync(EVENTS_FILE, JSON.stringify({ scenario: SCENARIO, event, ...fields }) + '\n');
};

const HOSTILE_PROMPT = '安全抽测 hostile';

/** The in-page audit of one DOM root: every hostile string present VERBATIM
 * as text, zero script/img elements, zero on* attributes. */
const AUDIT = `(() => {
  const root = document.getElementById('appshell-root');
  const all = [...root.querySelectorAll('*')];
  const texts = all.map((e) => e.textContent).join('\\u0001');
  const hostile = ${JSON.stringify(APP_SHELL_HOSTILE_TEXTS)};
  const verbatim = hostile.filter((h) => texts.includes(h));
  const scripts = root.querySelectorAll('script').length;
  const imgs = root.querySelectorAll('img').length;
  const onAttrs = all.reduce((n, e) =>
    n + [...e.attributes].filter((a) => a.name.toLowerCase().startsWith('on')).length, 0);
  return { verbatim: verbatim.length, hostile: hostile.length, scripts, imgs, onAttrs };
})()`;

const carried = openCarriedPage();
let page;
const pageErrors = [];
afterAll(async () => {
  if (page && pageErrors.length === 0) {
    expect(pageErrors, 'page errors: ' + pageErrors.join(' | ')).toEqual([]);
    milestone('m4/page-errors-zero', { errors: 0 });
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


/** The preview-strip audit: same shape as AUDIT but scoped to the tool
 *  card's .appshell-preview host. */
const PREVIEW_AUDIT = `(() => {
  const rows = [...document.querySelectorAll('.appshell-tool-row')];
  const host = rows[rows.length - 1].querySelector('.appshell-preview');
  const all = [...host.querySelectorAll('*')];
  const texts = all.map((e) => e.textContent).join('\u0001');
  const hostile = ${JSON.stringify(APP_SHELL_HOSTILE_TEXTS)};
  return {
    verbatim: hostile.filter((h) => texts.includes(h)).length,
    scripts: host.querySelectorAll('script').length,
    imgs: host.querySelectorAll('img').length,
    onAttrs: all.reduce((n, e) =>
      n + [...e.attributes].filter((a) => a.name.toLowerCase().startsWith('on')).length, 0),
  };
})()`;

/** Expand the hostile card's group and click its open button, in-page. */
const openHostileSurface = () => page.evaluate(() => {
  const rows = [...document.querySelectorAll('.appshell-tool-row')];
  const last = rows[rows.length - 1];
  if (!last || !last.textContent.includes('hostile')) return false;
  const group = last.closest('.group');
  if (group && !group.classList.contains('open')) group.querySelector('.group-header')?.click();
  const button = last.querySelector('.appshell-open-btn');
  if (!button || button.offsetParent === null) return false;
  button.click();
  return true;
});

const auditOf = () => page.evaluate(AUDIT);
const previewAuditOf = () => page.evaluate(PREVIEW_AUDIT);

const bootFixtureCheck = async () => {
  const env = await carried;
  page = env.page;
  page.on('pageerror', (err) => pageErrors.push(String(err)));
  const script = appShellScriptFor(1, HOSTILE_PROMPT, 'm4');
  expect(script).not.toBeNull();
  const echo = JSON.parse(
    script.settle.find((r) => r.type === 'tool/result').data.message.content[0].content[0].text);
  const verdict = validate(echo.spec);
  expect(verdict.ok, JSON.stringify(verdict.errors)).toBe(true);
  milestone('m4/boot', { fixture: 'validator-clean hostile spec' });
};

const previewInertLeg = async () => {
  await STATES.home.drive(page);
  await STATES.session.drive(page);
  await waitTurnSettled();
  await page.waitForSelector('#composer-input', { visible: true });
  await page.click('#composer-input');
  await page.type('#composer-input', HOSTILE_PROMPT);
  await page.click('#composer-send');
  await waitFor(
    () => page.evaluate(() => {
      const rows = [...document.querySelectorAll('.appshell-tool-row')];
      const last = rows[rows.length - 1];
      return last !== undefined && last.textContent.includes('hostile')
        && last.querySelector('.appshell-preview')?.children?.length > 0;
    }),
    'the hostile preview card rendered',
  );
  const previewAudit = await previewAuditOf();
  expect(previewAudit.scripts).toBe(0);
  expect(previewAudit.imgs).toBe(0);
  expect(previewAudit.onAttrs).toBe(0);
  milestone('m4/preview-inert', { scripts: 0, imgs: 0, onAttrs: 0 });
};

const surfaceVerbatimLeg = async () => {
  await waitFor(openHostileSurface, 'the hostile surface opened');
  await waitFor(
    () => page.evaluate(() => document.getElementById('appshell-view')?.hidden === false),
    'the surface visible',
  );
  const audit = await auditOf();
  expect(audit.verbatim, `hostile strings rendered verbatim (${audit.verbatim}/${audit.hostile})`)
    .toBe(APP_SHELL_HOSTILE_TEXTS.length);
  expect(audit.scripts).toBe(0);
  expect(audit.imgs).toBe(0);
  expect(audit.onAttrs).toBe(0);
  milestone('m4/surface-verbatim', {
    verbatim: audit.verbatim, hostile: audit.hostile,
    scripts: audit.scripts, imgs: audit.imgs, onAttrs: audit.onAttrs,
  });
};

describe('M4: hostile text renders 100% literal through the carrier stack', () => {
  it('boots and the hostile fixture itself is validator-clean (purity, not censorship)', bootFixtureCheck);
  it('the timeline card preview renders the hostile spec without executing anything', previewInertLeg);
  it('the fullscreen surface renders every hostile string VERBATIM, zero executable structure', surfaceVerbatimLeg);
});
