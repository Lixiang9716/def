// dsh:logging-exempt (node-side driver: console IS the product)
/**
 * visual-diff.mjs — the warn-tier visual regression signal (test-hardening
 * row 4): captures the four audited states (onboarding / home /
 * marketplace / session) of web-client-v2 on the dev carrier's next-mode
 * seat, in both appearances, and pixel-compares each against its committed
 * baseline (tools/dev-web-carrier/artifacts/ui-sweep/baselines/).
 *
 * Warn-tier contract: drift prints WARN lines, writes the diff image and a
 * verdict JSON under tmp/dev-web-carrier/visual-diff/, and EXITS NON-ZERO —
 * but nothing gates on it. Screenshots are a local/PR signal only (the
 * E2E-by-logs iron rule); no CI step or gov gate invokes this file, and it
 * is deliberately outside the vitest face.
 *
 * usage:
 *   node tools/dev-web-carrier/visual-diff.mjs                    # compare
 *   node tools/dev-web-carrier/visual-diff.mjs --update-baseline  # re-capture
 *   node tools/dev-web-carrier/visual-diff.mjs --max-diff-pixels 64
 *   node tools/dev-web-carrier/visual-diff.mjs --states home,session --schemes dark
 *
 * Baselines are captured per machine family — font hinting and antialiasing
 * differ across OSes, so re-capture (`--update-baseline`) after intentional
 * visual change and compare only like against like. Determinism: the
 * reduced-motion product answer stops the ambient loops (the same a11y
 * feature makes pixel baselines possible), settleFrame waits out finite
 * animations, and the carrier's fixture-epoch guard keeps timestamps out of
 * the frames.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  closeCarriedPage, openCarriedPage, settleFrame, STATES, walkStates,
} from '../../test/tools/helpers/carrier-page.mjs';
import { comparePng, verdict, writePng } from '../../test/tools/helpers/visual-diff-core.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..');
const BASELINE_DIR = join(HERE, 'artifacts', 'ui-sweep', 'baselines');
const DIFF_DIR = join(REPO_ROOT, 'tmp', 'dev-web-carrier', 'visual-diff');
const APPEARANCES = ['dark', 'light'];

const parseArgs = (argv) => {
  const args = {
    updateBaseline: false, maxDiffPixels: 0,
    states: Object.values(STATES).map((state) => state.label), schemes: APPEARANCES,
  };
  for (let at = 0; at < argv.length; at++) {
    const arg = argv[at];
    if (arg === '--update-baseline') args.updateBaseline = true;
    else if (arg === '--max-diff-pixels') args.maxDiffPixels = Number(argv[++at]);
    else if (arg === '--states') args.states = argv[++at].split(',');
    else if (arg === '--schemes') args.schemes = argv[++at].split(',');
    else throw new Error(`visual-diff: unknown argument '${arg}'`);
  }
  const known = Object.values(STATES).map((state) => state.label);
  for (const name of [...args.states, ...args.schemes]) {
    if (!known.includes(name) && !APPEARANCES.includes(name)) {
      throw new Error(`visual-diff: unknown name '${name}' `
        + `(states: ${known.join('/')}; schemes: ${APPEARANCES.join('/')})`);
    }
  }
  return args;
};

/** Captures every requested state × appearance; returns the frames keyed
 * `<state>-<scheme>`. One browser boot per appearance. */
const captureFrames = async (states, schemes) => {
  const frames = new Map();
  for (const scheme of schemes) {
    const session = await openCarriedPage({ colorScheme: scheme });
    try {
      for (const state of Object.values(STATES)) {
        if (!states.includes(state.label)) continue;
        await state.drive(session.page);
        await settleFrame(session.page);
        frames.set(`${state.label}-${scheme}`,
          await session.page.screenshot({ type: 'png' }));
      }
    } finally {
      await closeCarriedPage(session);
    }
  }
  return frames;
};

/** Compares every captured frame against its baseline; prints one line
 * per frame (ok / WARN), writes diff images for drifted frames, and
 * returns the results with the drifted count. */
const compareFrames = (frames, args) => {
  mkdirSync(DIFF_DIR, { recursive: true });
  const results = [];
  let drifted = 0;
  for (const [name, png] of frames) {
    const baselinePath = join(BASELINE_DIR, `${name}.png`);
    let baseline;
    try {
      baseline = readFileSync(baselinePath);
    } catch {
      throw new Error(`visual-diff: no baseline for ${name} (${baselinePath}). `
        + 'Capture one first: node tools/dev-web-carrier/visual-diff.mjs --update-baseline');
    }
    const comparison = comparePng(baseline, png);
    const call = verdict(comparison, args.maxDiffPixels);
    if (call.drift) {
      drifted += 1;
      writeFileSync(join(DIFF_DIR, `${name}-diff.png`), comparison.diffPng);
      console.warn(`[visual-diff] WARN: ${name} drifted — `
        + `${comparison.diffPixels} px (${(comparison.diffRatio * 100).toFixed(3)}% of `
        + `${comparison.width}x${comparison.height}) over budget ${args.maxDiffPixels}; `
        + `diff image: tmp/dev-web-carrier/visual-diff/${name}-diff.png`);
    } else {
      console.log(`[visual-diff] ok: ${name} `
        + `(${comparison.diffPixels} diff px, budget ${args.maxDiffPixels})`);
    }
    results.push({ name, ...comparison, diffPng: undefined, ...call });
  }
  writeFileSync(join(DIFF_DIR, 'verdict.json'),
    JSON.stringify({ maxDiffPixels: args.maxDiffPixels, drifted, results }, null, 2));
  return drifted;
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  console.log(`[visual-diff] capturing ${args.states.length} states `
    + `x ${args.schemes.length} appearance(s) on the next-mode carrier…`);
  const frames = await captureFrames(args.states, args.schemes);

  if (args.updateBaseline) {
    mkdirSync(BASELINE_DIR, { recursive: true });
    for (const [name, png] of frames) {
      writeFileSync(join(BASELINE_DIR, `${name}.png`), png);
      console.log(`[visual-diff] baseline written: artifacts/ui-sweep/baselines/${name}.png`);
    }
    console.log(`[visual-diff] OK — ${frames.size} baseline(s) updated; `
      + 'commit them with the change that moved the pixels.');
    return;
  }

  const drifted = compareFrames(frames, args);
  if (drifted > 0) {
    console.warn(`[visual-diff] WARN verdict: ${drifted}/${frames.size} frame(s) drifted. `
      + 'This is a WARN-tier signal — never a gate (E2E-by-logs). If the change is '
      + 'intentional, re-capture with --update-baseline and commit the baselines.');
    process.exitCode = 1;
  } else {
    console.log(`[visual-diff] OK — ${frames.size} frame(s) within budget `
      + `(verdict: tmp/dev-web-carrier/visual-diff/verdict.json)`);
  }
};

main().catch((error) => {
  console.error('[visual-diff] fatal:', error?.stack ?? error);
  process.exit(1);
});
