// Property suite for runtime/dsh/upstream/shims/path.js (test-hardening
// row 7). The module header states the contract the differentials pin: the
// POSIX face carries NODE-EXACT semantics ("the algorithms below are node's
// lib/path.js posix half"); the win32 namespace is claimed node-exact for
// parse/isAbsolute/basename only.
//
// The oracle is the REAL node:path — imported through createRequire because
// a plain `node:path` specifier hits the panel config's path-posix.mjs pin
// (the same trick that file itself uses; see test/panel/path-posix.mjs).
//
// Differential coverage is deliberately scoped to what discovery fuzzing
// (400k full-Unicode inputs per face, 2026-10-16) proved exact; the
// divergences it found outside that scope are findings, not asserted spec —
// each carve-out below names the divergence and it is reported in the PR:
//
//   posix.format   vs node: node inserts the dot between name and ext when
//                  ext lacks it and uses root when dir is PRESENT-but-empty
//                  (|| vs the shim's ??); the shim header even documents the
//                  dot rule its code does not implement. Exact only over
//                  parse()-shaped objects (P5; clean across the sweep).
//   posix.parse    vs node 24: node ≥24's reworked parse emits ext='.' /
//                  name='.' for the absolute '/..' family (root='/' with
//                  dir='/' and base='..' — e.g. parse('/../')); the shim,
//                  built on the pre-24 machine, emits ext='' / name='..'.
//                  Every other field agrees there and every input outside
//                  that family agrees field-for-field (P3 pins exactly
//                  that; the 400k-input sweep found only this family).
//   win32.normalize/parse/dirname/extname/relative/resolve/toNamespacedPath
//                  vs node: the shim derives these from win32SplitRoot +
//                  segment joins (trailing separators dropped, interior
//                  separators collapsed, no cwd-aware drive-relative
//                  resolution, unconditional \\?\ prefixing) — diverges from
//                  node's state machines broadly (5-97% of fuzz inputs).
//   win32.basename(path, suffix): node's suffix machine disagrees on root-
//                  anchored paths (basename('C:\\', '/') === '\\' in node,
//                  '' in the shim) and returns the separators themselves for
//                  all-separator paths with a non-matching suffix — only the
//                  one-argument form is differentially asserted.
//
// Clean under the same sweep (and differentially asserted here): the whole
// POSIX face outside those two families, win32.isAbsolute, and win32.basename
// without a suffix.
import { expect, it } from 'vitest';
import fc from 'fast-check';
import { createRequire } from 'node:module';
import * as pathShim from '../../../runtime/dsh/upstream/shims/path.js';

const nodePath = createRequire(import.meta.url)('node:path');
const { posix: realPosix, win32: realWin32 } = nodePath;

// Arbitrary paths: a pure-chaos arm (full unicode, exercises the state
// machines on arbitrary code points) and a structured arm biased to the
// characters the algorithms branch on.
const SEGMENTS = [
  '/', '//', '///', '\\', '.', '..', '...', 'a', 'b', 'ab', '.hidden',
  'x.txt', 'a.b.c', '.a.b', 'a..b', ' ', '~', '-', '--', 'C:', 'C:\\',
  '\\\\srv\\sh', './', '../', '/a', 'a/', 'a/b', '0', '9',
];
const pathArb = fc.oneof(
  fc.string({ maxLength: 48 }),
  fc.array(fc.constantFrom(...SEGMENTS), { maxLength: 10 }).map((parts) => parts.join('')),
);

const both = (shimFace, realFace, input, ...rest) => {
  let shimResult;
  let realResult;
  try {
    shimResult = shimFace(input, ...rest);
  } catch (error) {
    shimResult = `THROW:${error.constructor.name}`;
  }
  try {
    realResult = realFace(input, ...rest);
  } catch (error) {
    realResult = `THROW:${error.constructor.name}`;
  }
  return [shimResult, realResult];
};

/** The parse carve-out family (see header): node ≥24's reworked parse emits
 * ext='.', name='.' for the absolute '/..' family; the shim emits '',
 * base. Root/dir/base still agree — compare only those there. */
const parseKnownDivergent = (nodeParsed) => nodeParsed.root === '/'
  && nodeParsed.dir === '/'
  && nodeParsed.base === '..';

it('P1 normalize / isAbsolute / dirname / basename / extname / toNamespacedPath', () => {
  fc.assert(
    fc.property(pathArb, (p) => {
      for (const [shimFace, realFace] of [
        [pathShim.normalize, realPosix.normalize],
        [pathShim.dirname, realPosix.dirname],
        [pathShim.basename, realPosix.basename],
        [pathShim.extname, realPosix.extname],
        [pathShim.toNamespacedPath, realPosix.toNamespacedPath],
      ]) {
        const [shimResult, realResult] = both(shimFace, realFace, p);
        expect(shimResult).toBe(realResult);
      }
      expect(String(pathShim.isAbsolute(p))).toBe(String(realPosix.isAbsolute(p)));
    }),
    { numRuns: 2000 },
  );
});

it('P2 basename(path, suffix) matches node for arbitrary suffixes', () => {
  fc.assert(
    fc.property(pathArb, pathArb, (p, suffix) => {
      expect(pathShim.basename(p, suffix)).toBe(realPosix.basename(p, suffix));
    }),
    { numRuns: 1000 },
  );
});

it('P3 parse matches node field-for-field outside the known /.. family', () => {
  fc.assert(
    fc.property(pathArb, (p) => {
      const nodeParsed = realPosix.parse(p);
      if (parseKnownDivergent(nodeParsed)) {
        // The carve-out: root/dir/base agree, ext/name are the node-24
        // rework's (see header). Assert the agreeing fields so the family
        // stays covered and a widening divergence still trips.
        const shimParsed = pathShim.parse(p);
        expect(shimParsed.root).toBe(nodeParsed.root);
        expect(shimParsed.dir).toBe(nodeParsed.dir);
        expect(shimParsed.base).toBe(nodeParsed.base);
        return;
      }
      expect(pathShim.parse(p)).toStrictEqual(nodeParsed);
    }),
    { numRuns: 2000 },
  );
});

it('P4 resolve / relative / join match node under one process cwd', () => {
  // Both faces read the SAME process.cwd() (vitest's), so resolve is
  // differentiable; the paired arguments are the identical values.
  fc.assert(
    fc.property(pathArb, pathArb, (p, q) => {
      expect(pathShim.resolve(p, q)).toBe(realPosix.resolve(p, q));
      expect(pathShim.relative(p, q)).toBe(realPosix.relative(p, q));
      expect(pathShim.join(p, q)).toBe(realPosix.join(p, q));
    }),
    { numRuns: 1000 },
  );
});

it('P5 format matches node over parse()-shaped objects', () => {
  // The only clean differential domain for format (see header carve-out):
  // objects produced by parse, the shape every in-repo caller feeds it.
  fc.assert(
    fc.property(pathArb, (p) => {
      const shaped = realPosix.parse(p);
      expect(pathShim.format(shaped)).toBe(realPosix.format(shaped));
    }),
    { numRuns: 2000 },
  );
});

it('P6 totality: arbitrary strings never crash any POSIX face', () => {
  fc.assert(
    fc.property(pathArb, (p) => {
      expect(typeof pathShim.normalize(p)).toBe('string');
      expect(typeof pathShim.isAbsolute(p)).toBe('boolean');
      expect(typeof pathShim.dirname(p)).toBe('string');
      expect(typeof pathShim.basename(p)).toBe('string');
      expect(typeof pathShim.extname(p)).toBe('string');
      expect(typeof pathShim.toNamespacedPath(p)).toBe('string');
      const parsed = pathShim.parse(p);
      for (const field of ['root', 'dir', 'base', 'ext', 'name']) {
        expect(typeof parsed[field]).toBe('string');
      }
    }),
    { numRuns: 2000 },
  );
});

it('P7 win32 isAbsolute and basename (one-arg) match node', () => {
  fc.assert(
    fc.property(pathArb, (p) => {
      expect(String(pathShim.win32.isAbsolute(p))).toBe(String(realWin32.isAbsolute(p)));
      expect(pathShim.win32.basename(p)).toBe(realWin32.basename(p));
    }),
    { numRuns: 2000 },
  );
});

it('P8 every win32 face is total over strings with node-shaped results', () => {
  fc.assert(
    fc.property(pathArb, (p) => {
      for (const face of ['normalize', 'dirname', 'basename', 'extname', 'toNamespacedPath']) {
        expect(typeof pathShim.win32[face](p)).toBe('string');
      }
      expect(typeof pathShim.win32.isAbsolute(p)).toBe('boolean');
      const parsed = pathShim.win32.parse(p);
      expect(Object.keys(parsed).sort()).toEqual(['base', 'dir', 'ext', 'name', 'root']);
      for (const field of Object.keys(parsed)) {
        expect(typeof parsed[field]).toBe('string');
      }
    }),
    { numRuns: 2000 },
  );
});
