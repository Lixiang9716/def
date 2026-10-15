# Agent Note: the three runtime parsers gain property suites (fast-check) under test/panel/fastcheck

Status: implemented

## Problem

The three pure parsers the web plane and the marketplace lean on —
dsh-shell-js's `parseCommandLine`, the node:path shim, and
`semver-range` — were covered only by example-based unit tests: hand-picked
inputs, hand-written expectations. Arbitrary string input (the reality of
every command line, path, and catalog range) had no systematic coverage,
and differential claims ("node-exact path semantics") had no executable
witness against the real node.

## Decision

test/panel/fastcheck/ carries three fast-check suites (28 properties,
every property ≥200 runs): no-crash/typed-refusal totality for arbitrary
strings, purity, and the documented contract faces of each parser
(separators, quoting fold, expansion loc, range algebra, ordering laws).
The path suite differentially asserts the POSIX face against the real
node:path via createRequire. Differentials are scoped to what 400k-input
discovery fuzzing proved exact; each carve-out is named in the suite
comment and in the PR (win32 namespace breadth, posix.format's
degenerate-object cases).

The suite found one REAL source bug it now documents as an expected
failure (`it.fails`, semver P9): `versionLess` compares majors only
(`split(/[.+-]/)[0]` keeps the major string), so the documented
release-segment order is violated and marketplace.js:183's
highest-version-per-id anchor is order-dependent for same-major versions
(`2.9.0` can anchor over `2.10.0`). The fix belongs to
runtime/dsh/semver-range.js (outside the suite's file face); when fixed,
semver P9 goes red and flips to a normal property.

Two smaller differential carve-outs are documented in the suite headers as
findings (not asserted spec): node ≥24's reworked path.parse emits
ext='.' / name='.' for the absolute '/..' family where the shim emits
ext='' / name='..', and the win32 namespace's unclaimed faces diverge
broadly (trailing separators, cwd-relative resolution, `\\?\` prefixing).

The runner is test/panel/fastcheck/run.sh (same provisioning shape as
test/panel/run.sh; deps are the parent's node_modules) plus a
`test:fastcheck` package script. The panel gate's own run does not collect
this directory (its include is top-level `*.test.js`), so 489/489 stays
byte-identical; wiring the runner into a gate is the coordinator's
one-line follow-up (gates.json is shared in this wave).

## Alternatives considered

- Patching versionLess in the same PR: rejected — Wave-2 file-face
  ownership (test/panel/fastcheck/ + test/panel/package.json only); a
  behavior fix in runtime/dsh needs its own note, review, and downstream
  check.
- Asserting the current majors-only behavior as spec: rejected — that
  codifies the bug; `it.fails` keeps the documented contract
  machine-checked as a known violation instead.
- Whole-namespace win32 differentials: rejected — the fuzz measured 5–97%
  divergence on the unclaimed faces (trailing separators, cwd-relative
  resolution, `\\?\` prefixing); asserting them would land a red suite, and
  asserting the divergent behavior would lie about the contract. The
  header claims parse/isAbsolute/basename; those two clean faces are
  differentially asserted.
