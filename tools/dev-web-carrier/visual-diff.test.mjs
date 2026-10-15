// dsh:logging-exempt (test leg: assertions ARE the product)
/**
 * visual-diff.test.mjs — the threshold teeth of the warn-tier visual
 * regression (test-hardening row 4). Synthetic PNGs prove the compare
 * core without a browser: identical frames pass with zero drift, one
 * changed pixel is drift over a zero budget yet inside a nonzero budget,
 * the budget boundary is exact, and a dimension mismatch fails loud
 * naming both sizes (rule 5). The browser capture half is the
 * visual-diff.mjs runner, deliberately outside the vitest face (a manual
 * signal, never a gate — E2E-by-logs).
 */
import { describe, expect, it } from 'vitest';
import {
  comparePng, readPng, solidPng, verdict, writePng,
} from '../../test/tools/helpers/visual-diff-core.mjs';

const NAVY = [10, 20, 30];
const SIZE = [4, 2];

/** The solid PNG with exactly one pixel's red channel moved. */
const onePixelOff = (buffer) => {
  const png = readPng(buffer);
  png.data[8] = 254; // pixel (2,0): red 0 → 254
  return writePng(png);
};

describe('visual-diff-core: the warn-tier threshold teeth', () => {
  it('identical frames: zero drift pixels, green verdict, no drift', () => {
    const baseline = solidPng(...SIZE, NAVY);
    const comparison = comparePng(baseline, solidPng(...SIZE, NAVY));
    expect(comparison.diffPixels).toBe(0);
    expect(comparison.diffRatio).toBe(0);
    expect(verdict(comparison)).toEqual({ drift: false, diffPixels: 0, budget: 0 });
  });

  it('one changed pixel is drift over the zero budget', () => {
    const baseline = solidPng(...SIZE, NAVY);
    const comparison = comparePng(baseline, onePixelOff(baseline));
    expect(comparison.diffPixels).toBe(1);
    expect(comparison.diffPng.length).toBeGreaterThan(0);
    expect(verdict(comparison, 0)).toEqual({ drift: true, diffPixels: 1, budget: 0 });
  });

  it('the budget boundary is exact: 1 pixel inside budget=1 stays green', () => {
    const baseline = solidPng(...SIZE, NAVY);
    const comparison = comparePng(baseline, onePixelOff(baseline));
    expect(verdict(comparison, 1)).toEqual({ drift: false, diffPixels: 1, budget: 1 });
    expect(verdict(comparison, 2).drift).toBe(false);
  });

  it('a dimension mismatch fails loud naming both sizes', () => {
    expect(() => comparePng(solidPng(...SIZE, NAVY), solidPng(8, 2, NAVY)))
      .toThrow(/dimension drift.*8x2/);
  });
});
