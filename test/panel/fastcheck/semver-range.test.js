// Property suite for runtime/dsh/semver-range.js (test-hardening row 7).
// The module header states the contracts the properties pin:
//
//   - satisfies(version, range) is total over strings: boolean, or
//     InstallRejected thrown EXACTLY when the range string is outside the
//     v0 grammar (fail loud, rule 5) — '*' and '' match everything;
//   - the range algebra is the documented v0 subset: exact / ^ / ~;
//   - versionLess is a strict order on release segments (prerelease and
//     build metadata ignored).
//
// Version arbitraries are CANONICAL x.y.z strings (bounded non-negative
// integers) for the order/algebra properties — the grammar the marketplace
// catalog actually feeds in; free-form strings exercise totality.
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { satisfies, versionLess } from '../../../runtime/dsh/semver-range.js';
import { InstallRejected } from '../../../runtime/dsh/install-pipeline.js';

const tripleArb = fc.tuple(
fc.nat({ max: 40 }),
fc.nat({ max: 40 }),
fc.nat({ max: 40 }),
);
const versionArb = tripleArb.map(([mj, mn, pa]) => `${mj}.${mn}.${pa}`);

/** Release-segment equality, defined through versionLess itself (the module
 * ships no equality face). */
const releaseEqual = (a, b) => !versionLess(a, b) && !versionLess(b, a);

/** Upward-closure checks for one generated tuple — hoisted to module level
 * to keep the property arrow inside the code-size ruler's indent budget. */
const assertUpwardClosure = (major, aMinor, bMinor, anchorPatch) => {
  const asc = (x, y) => x - y;
  // CARET: shared major, lex-sorted minors.
  const [cLowMinor, cHighMinor] = [aMinor, bMinor].sort(asc);
  const caret = `^${major}.${aMinor}.${anchorPatch}`;
  const cLow = `${major}.${cLowMinor}.${anchorPatch}`;
  const cHigh = `${major}.${cHighMinor}.${anchorPatch}`;
  if (satisfies(cLow, caret)) {
    expect(satisfies(cHigh, caret)).toBe(true);
  }
  // TILDE: shared minor, lex-sorted patches.
  const [tLowPatch, tHighPatch] = [aMinor, bMinor].sort(asc);
  const tilde = `~${major}.${bMinor}.${anchorPatch}`;
  const tLow = `${major}.${bMinor}.${tLowPatch}`;
  const tHigh = `${major}.${bMinor}.${tHighPatch}`;
  if (satisfies(tLow, tilde)) {
    expect(satisfies(tHigh, tilde)).toBe(true);
  }
};

it('P1 totality: boolean, or InstallRejected exactly for out-of-grammar ranges', () => {
  // The throw oracle is the module's own fail-loud boundary: a range is
  // supported iff '', '*', or ^/~ anchored x.y.z. Anything else rejects.
  const GRAMMAR = /^(\^|~)?(\d+)\.(\d+)\.(\d+)$/;
  fc.assert(
    fc.property(fc.string({ maxLength: 24 }), fc.string({ maxLength: 24 }), (version, range) => {
      const inGrammar = range === '*' || range === '' || GRAMMAR.test(range);
      let result;
      try {
        result = { threw: false, value: satisfies(version, range) };
      } catch (error) {
        result = { threw: true, error };
      }
      if (result.threw) {
        expect(inGrammar).toBe(false);
        expect(result.error).toBeInstanceOf(InstallRejected);
        expect(result.error.name).toBe('InstallRejected');
      } else {
        expect(inGrammar).toBe(true);
        expect(typeof result.value).toBe('boolean');
      }
    }),
    { numRuns: 500 },
  );
});

it('P2 reflexivity: a version satisfies its own exact, caret, and tilde range', () => {
  fc.assert(
    fc.property(versionArb, (v) => {
      expect(satisfies(v, v)).toBe(true);
      expect(satisfies(v, `^${v}`)).toBe(true);
      expect(satisfies(v, `~${v}`)).toBe(true);
    }),
    { numRuns: 500 },
  );
});

it('P3 wildcard: "*" and "" accept every version string', () => {
  fc.assert(
    fc.property(fc.string({ maxLength: 24 }), (version) => {
      expect(satisfies(version, '*')).toBe(true);
      expect(satisfies(version, '')).toBe(true);
    }),
    { numRuns: 200 },
  );
});

it('P4 upward closure: caret within a major, tilde within a minor', () => {
  // The v0 range algebra is closed upward, not downward: ^ matches every
  // lex-later (minor, patch) pair inside the same major; ~ matches every
  // lex-later patch inside the same minor. Exact ranges are a point —
  // P2/P5/P9 pin those.
  fc.assert(
    fc.property(
      fc.nat({ max: 40 }),
      fc.nat({ max: 40 }),
      fc.nat({ max: 40 }),
      fc.nat({ max: 40 }),
      assertUpwardClosure,
    ),
    { numRuns: 500 },
  );
});

it('P5 boundary faces: caret excludes the next major, tilde the next minor', () => {
  // The v0 grammar as this module defines it: ^ = same major, (minor,
  // patch) at-or-after the anchor — so the next minor still matches (the
  // npm 0.x special rules are not part of the grammar); ~ pins the minor.
  fc.assert(
    fc.property(
      fc.nat({ max: 40 }),
      fc.nat({ max: 40 }),
      fc.nat({ max: 40 }),
      (major, minor, patch) => {
        const v = `${major}.${minor}.${patch}`;
        expect(satisfies(`${major}.${minor + 1}.0`, `^${v}`)).toBe(true);
        expect(satisfies(`${major + 1}.0.0`, `^${v}`)).toBe(false);
        expect(satisfies(`${major}.${minor}.${patch + 1}`, `^${v}`)).toBe(true);
        expect(satisfies(`${major}.${minor}.${patch + 1}`, `~${v}`)).toBe(true);
        expect(satisfies(`${major}.${minor + 1}.0`, `~${v}`)).toBe(false);
        expect(satisfies(`${major + 1}.0.0`, `~${v}`)).toBe(false);
      },
    ),
    { numRuns: 500 },
  );
});

it('P6 trichotomy: exactly one of a<b, b<a, release-equal holds', () => {
  fc.assert(
    fc.property(versionArb, versionArb, (a, b) => {
      const score = (versionLess(a, b) ? 1 : 0)
        + (versionLess(b, a) ? 1 : 0)
        + (releaseEqual(a, b) ? 1 : 0);
      expect(score).toBe(1);
    }),
    { numRuns: 500 },
  );
});

it('P7 transitivity: a<b and b<c imply a<c', () => {
  fc.assert(
    fc.property(versionArb, versionArb, versionArb, (a, b, c) => {
      if (versionLess(a, b) && versionLess(b, c)) {
        expect(versionLess(a, c)).toBe(true);
      }
    }),
    { numRuns: 500 },
  );
});

it('P8 prerelease and build metadata never move the release order', () => {
  fc.assert(
    fc.property(versionArb, versionArb, (a, b) => {
      expect(versionLess(`${a}-rc.1+build.9`, `${b}-x.2+y`)).toBe(versionLess(a, b));
    }),
    { numRuns: 500 },
  );
});

it.fails('P9 KNOWN BUG: exact ranges agree with the release order (versionLess compares majors only)', () => {
  // DISCOVERED BY THIS PROPERTY 2026-10-16, reported, fix owned by
  // runtime/dsh/semver-range.js (outside this suite's file face):
  //
  //   const pa = a.split(/[.+-]/)[0].split('.').map(Number);
  //
  // split(/[.+-]/) already splits on the dots, so [0] keeps ONLY the
  // major ('39.0.0' → [39]) and versionLess('2.9.0', '2.10.0') is FALSE.
  // The docstring contract is "True iff semver a < semver b (release
  // segments only)"; marketplace.js:183 uses it for the
  // highest-version-per-id anchor, which is therefore order-dependent
  // whenever same-major versions differ below the major.
  //
  // it.fails keeps this documented contract machine-checked as an
  // EXPECTED failure: it passes only while the violation exists and goes
  // red the moment versionLess is fixed — flip it to a normal `it` then.
  // (Caveat inherent to it.fails: any error passes it, so it proves
  // nothing about OTHER regressions in this path.)
  fc.assert(
    fc.property(versionArb, versionArb, (version, anchor) => {
      expect(satisfies(version, anchor)).toBe(releaseEqual(version, anchor));
    }),
    { numRuns: 500 },
  );
  expect(versionLess('2.9.0', '2.10.0')).toBe(true);
});

it('P10 totality of versionLess: boolean for arbitrary strings, no crash', () => {
  fc.assert(
    fc.property(fc.string({ maxLength: 24 }), fc.string({ maxLength: 24 }), (a, b) => {
      expect(typeof versionLess(a, b)).toBe('boolean');
    }),
    { numRuns: 500 },
  );
});
