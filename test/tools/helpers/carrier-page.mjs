// dsh:logging-exempt (node-side driver: console IS the product)
/**
 * carrier-page.mjs — the shared browser leg of the web-regression family:
 * boots the `--client next` dev carrier in-process (next-mode.mjs), opens
 * the served web-client-v2 page in the machine's installed Chrome
 * (puppeteer-core — never a downloaded browser), and drives it into the
 * four audited states (onboarding / home / marketplace / session) with
 * condition waits, never blind sleeps (rules.md rule 8).
 *
 * Both consumers ride this file: axe-sweep.test.mjs (the a11y regression
 * leg, wired into the tools vitest face) and visual-diff.mjs (the
 * warn-tier pixel-diff signal). Browser discovery order: $DSH_WEBREG_CHROME
 * → PATH (google-chrome/google-chrome-stable/chromium/chrome) → the macOS
 * app bundle → fail loud naming every location tried (rule 5). CI's
 * ubuntu runners ship Google Chrome on PATH; a machine without any
 * Chromium-family browser fails with install instructions, never a skip.
 *
 * Determinism: mobile viewport (390×844 @2x, the #519 audit's viewport),
 * prefers-reduced-motion: reduce (the #519 product answer stops the
 * ambient loops — the same a11y feature is what makes pixel baselines
 * possible), and the page's own fixture-epoch guard keeps relative-time
 * text stable (render-home.js returns '' for dev epochs).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { startNextCarrier } from '../../../tools/dev-web-carrier/next-mode.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..');
const CARRIER = join(REPO_ROOT, 'tools', 'dev-web-carrier');
const require = createRequire(import.meta.url);

export const VIEWPORT = { width: 390, height: 844, deviceScaleFactor: 2 };

const CHROME_CANDIDATES = {
  env: process.env.DSH_WEBREG_CHROME,
  path: ['google-chrome', 'google-chrome-stable', 'chromium', 'chrome'],
  mac: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
};

/** The machine's Chromium-family browser, or a loud refusal naming every
 * location tried. `which` is probed one candidate at a time so a missing
 * name is an ordinary miss, never a crash. */
export const findChrome = () => {
  const tried = [];
  const env = CHROME_CANDIDATES.env;
  if (env) {
    if (existsSync(env)) return env;
    tried.push(`$DSH_WEBREG_CHROME=${env} (not a file)`);
  }
  for (const name of CHROME_CANDIDATES.path) {
    try {
      const resolved = execFileSync('which', [name], { encoding: 'utf8' }).trim();
      if (resolved !== '') return resolved;
    } catch { /* not on PATH — keep walking */ }
    tried.push(`${name} (PATH)`);
  }
  for (const candidate of CHROME_CANDIDATES.mac) {
    if (existsSync(candidate)) return candidate;
    tried.push(candidate);
  }
  throw new Error(
    `carrier-page: no Chromium-family browser found (tried: ${tried.join(', ')}). `
    + 'Install Google Chrome, or point DSH_WEBREG_CHROME at an existing binary.');
};

const authedUrl = ({ server, token }) =>
  `http://127.0.0.1:${server.address().port}/?token=${token}`;

/** Boots carrier + browser + one carried page at one appearance. The page
 * has settled when the boot debug face exists AND the onboarding panel
 * marked itself settled (main.js waitColdStartSettled's own two facts),
 * observed with a deadline — never a blind wait. */
export const openCarriedPage = async ({
  colorScheme = 'dark', viewport = VIEWPORT,
} = {}) => {
  const carrier = await startNextCarrier({
    repoRoot: REPO_ROOT,
    port: 0,
    sessionsFixture: JSON.parse(readFileSync(join(CARRIER, 'fixtures/sessions.json'), 'utf8')),
    journalPath: join(CARRIER, 'fixtures/journal.jsonl'),
  });
  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--force-color-profile=srgb', '--hide-scrollbars'],
  });
  const page = await browser.newPage();
  await page.setViewport(viewport);
  await page.emulateMediaFeatures([
    { name: 'prefers-color-scheme', value: colorScheme },
    { name: 'prefers-reduced-motion', value: 'reduce' },
  ]);
  await page.goto(authedUrl(carrier), { waitUntil: 'networkidle2' });
  await waitFor(
    () => page.evaluate(() => window.__dshTimelineDebug !== undefined
      && document.getElementById('onboarding')?.dataset.settled === 'true'),
    'the page boot (mux open + onboarding settled)',
  );
  return { carrier, browser, page };
};

/** Polls a condition until it resolves truthy or the deadline passes — the
 * rule-8 posture. `probe` may be async and is awaited each round. */
export const waitFor = async (probe, what, timeoutMs = 15000) => {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const result = await probe();
    if (result) return result;
    if (Date.now() >= end) {
      throw new Error(`carrier-page: timed out after ${timeoutMs}ms waiting for ${what}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
};

/** The four audited states as drivers. Each waits for the state's OWN
 * visible fact before returning, so a scan or screenshot never races a
 * render. The walk is onboarding → home → marketplace → session; each
 * driver starts from the previous state (the onboarding panel is open at
 * boot; home closes it; marketplace opens over home; session closes it and
 * opens the fixture conversation). */
export const STATES = {
  onboarding: {
    label: 'onboarding',
    drive: (page) => waitFor(
      () => page.evaluate(() => !document.getElementById('onboarding')?.hidden
        && document.getElementById('onboarding-form')?.hidden === false),
      'the first-run BYOK panel (the boot state)',
    ),
  },
  home: {
    label: 'home',
    drive: async (page) => {
      await page.click('#onboarding-close');
      await waitFor(
        () => page.evaluate(() => document.getElementById('onboarding')?.hidden === true
          && document.getElementById('view-home')?.hidden === false),
        'the home view with the onboarding panel closed',
      );
    },
  },
  marketplace: {
    label: 'marketplace',
    drive: async (page) => {
      await page.click('#market-open');
      // The settled fact: the panel open AND its body answered — either the
      // verified-catalog line (a marketplace-enabled host) or the honest
      // unenabled note (what the next-mode dev carrier answers).
      await waitFor(
        () => page.evaluate(() => {
          if (document.getElementById('marketplace')?.hidden !== false) return false;
          const catalog = document.getElementById('market-catalog-line')?.textContent ?? '';
          const empty = document.getElementById('market-empty');
          return catalog !== '' || (empty?.hidden === false && empty.textContent !== '');
        }),
        'the marketplace panel with its body answer rendered',
      );
    },
  },
  session: {
    label: 'session',
    drive: async (page) => {
      const marketOpen = await page.$('#marketplace:not([hidden]) #market-close');
      if (marketOpen !== null) await page.click('#market-close');
      await page.click('#session-list .session-row');
      await waitFor(() => chatFolded(page), 'the chat view with the fixture journal folded');
    },
  },
};

/** The session state's settled fact: the chat view visible and the
 * fixture journal folded into timeline items (the page's own debug face). */
const chatFolded = (page) => page.evaluate(() => {
  const debug = window.__dshTimelineDebug?.() ?? null;
  return document.getElementById('view-chat')?.hidden === false
    && debug !== null && debug.items > 0;
});

/** Settles the current frame for pixel capture: every finite animation
 * runs to its end (the reduced-motion product answer already stopped the
 * ambient loops), then two rAFs guarantee a composited frame. A condition
 * wait over real animation physics, never a blind sleep (rule 8). */
export const settleFrame = (page) => page.evaluate(async () => {
  await Promise.all(document.getAnimations()
    .map((animation) => animation.finished.catch(() => { /* infinite: stopped */ })));
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
});

/** Runs axe-core over the CURRENT page state and returns its violations
 * (every impact) as plain rows. The axe script is the pinned devDependency,
 * injected fresh per scan. */
export const scanAxe = async (page) => {
  await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
  return page.evaluate(async () => {
    const results = await window.axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
      resultTypes: ['violations'],
    });
    return results.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      nodes: violation.nodes.map((node) => node.target.join(' ')),
    }));
  });
};

/** Visits every state in order and hands {state, violations} rows to the
 * caller's visit callback (axe-sweep) or captures them (visual-diff). */
export const walkStates = async (page, visit) => {
  for (const state of Object.values(STATES)) {
    await state.drive(page);
    await visit(state.label, page);
  }
};

/** Tears the browser down first, then the carrier; one leg's close failure
 * never masks the other's. */
export const closeCarriedPage = async ({ carrier, browser }) => {
  try { await browser.close(); } finally { await carrier.server.close(); }
};
