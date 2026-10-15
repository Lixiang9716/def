// dsh:logging-exempt (test helper: verdict IS the product)
/**
 * visual-diff-core.mjs — the pure half of the warn-tier visual regression
 * (test-hardening row 4): decode two PNGs, count differing pixels
 * (pixelmatch, YIQ threshold 0.1), and render the diff image. The browser
 * capture half lives in tools/dev-web-carrier/visual-diff.mjs; this module
 * is deliberately pure (bytes in, verdict out) so the vitest leg
 * (visual-diff.test.mjs) can prove the threshold teeth on synthetic PNGs
 * without a browser.
 *
 * Contract: a dimension mismatch fails loud naming both sizes (rule 5) —
 * a layout change is exactly the drift this net exists to catch, never a
 * silent resize-to-fit. `maxDiffPixels` is the drift budget (default 0:
 * with the reduced-motion capture the frames are deterministic, so any
 * differing pixel is drift); the diff image paints differing pixels red
 * over the dimmed baseline, pixelmatch's standard contrast view.
 */
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

export const PIXELMATCH_THRESHOLD = 0.1;

/** Decodes a PNG buffer to {width, height, data}. */
export const readPng = (buffer) => PNG.sync.read(buffer);

/** Re-encodes a decoded PNG to a buffer (the write side of readPng). */
export const writePng = (png) => PNG.sync.write(png);

/** Builds a solid-color RGB PNG buffer — the synthetic frames the teeth
 * test compares (the helper owns the codec import; test files stay
 * dependency-free under the tools glob). */
export const solidPng = (width, height, [r, g, b]) => {
  const png = new PNG({ width, height });
  for (let at = 0; at < png.data.length; at += 4) {
    png.data[at] = r;
    png.data[at + 1] = g;
    png.data[at + 2] = b;
    png.data[at + 3] = 255;
  }
  return PNG.sync.write(png);
};

/** Compares two PNG buffers. Returns {width, height, diffPixels,
 * diffRatio, diffPng} — diffPng is a PNG buffer painting the drift. */
export const comparePng = (baselineBuffer, currentBuffer, {
  threshold = PIXELMATCH_THRESHOLD,
} = {}) => {
  const baseline = readPng(baselineBuffer);
  const current = readPng(currentBuffer);
  if (baseline.width !== current.width || baseline.height !== current.height) {
    throw new Error(`visual-diff-core: dimension drift — baseline `
      + `${baseline.width}x${baseline.height} vs current `
      + `${current.width}x${current.height} (re-capture the baselines)`);
  }
  const diff = new PNG({ width: baseline.width, height: baseline.height });
  const diffPixels = pixelmatch(
    baseline.data, current.data, diff.data,
    baseline.width, baseline.height, { threshold },
  );
  return {
    width: baseline.width,
    height: baseline.height,
    diffPixels,
    diffRatio: diffPixels / (baseline.width * baseline.height),
    diffPng: PNG.sync.write(diff),
  };
};

/** The warn-tier verdict: drift when differing pixels exceed the budget.
 * The caller decides what drift MEANS (non-zero exit, WARN lines) — this
 * module never exits a process. */
export const verdict = (comparison, maxDiffPixels = 0) => ({
  drift: comparison.diffPixels > maxDiffPixels,
  diffPixels: comparison.diffPixels,
  budget: maxDiffPixels,
});
