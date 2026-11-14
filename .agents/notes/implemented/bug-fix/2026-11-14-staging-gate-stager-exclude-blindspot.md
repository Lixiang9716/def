# The staging gate's stager-exclude blind spot: graph-reached ∧ embedded ∧ unstaged is now a named BLINDSPOT finding

Status: implemented
Date: 2026-11-14 · Class: bug-fix · Issue: #798 (closes the class PR #797 fixed as an instance)

## Problem

The staging-check gate (`tools/check-staging.mjs --block harmony,android,ios`)
read only the EMBEDDER's declared lists (iOS: `gen_bundle_resources.py`
RESOURCES + `gen_bundle_header.py` TREES). It could not see the BundleStager's
own exclude policy (`tools/generated/staging/ios-stager.exclude.rows`), so a
file that is (a) reached by the import graph, (b) embedded in the binary (a
RESOURCES row), but (c) excluded from the launch-time staging writes AND not
covered by any TREES whole-dir mirror passed every gate — and died on-device
at import-link. That exact class killed every iOS interactive boot after #780
mounted dsh-mcp from the def bundle while the stale pre-#780 exclude rows
stayed (#691); PR #797 un-excluded the trio, closing the instance, not the
class. #667's default-include made a forgotten WRITE the exception — the
exclude store re-opens the same class from the other side: an exclusion is a
staging decision no gate was judging.

## Decision

The exclude store is now the third iOS staging face, with its own satellite
module `tools/check-staging-stager.mjs` (check-staging-hosts.mjs sits at the
500-line cap, so the concern splits per the existing one-concern-per-file
pattern):

- `readStagerFace()` parses the exclude store (comments/blanks dropped) and
  referent-checks every suffix against the declared RESOURCES rows — a
  suffix nothing embeds, or a missing store, exits 2 (default-include makes
  silence the failure). Parsed eagerly in the CLI's `main()` beside
  `buildHosts()`, so it fails loud whatever `--host` selected. The
  accessor→path mapping comes from the DECLARED rows store
  (`tools/generated/staging/ios-RESOURCES.rows`, `<suffix>=<rel>` with the
  `repo:` prefix and ` -> dest` tails) — the same store the emitted table
  derives from, not the materialized `.py` block (whose rows carry no dest
  tails).
- `stagerBlindSpots()` reports a finding for every exclude row whose file is
  graph-reached while no TREES mirror root covers its source path. The reach
  test runs on the row's BUNDLE destination — both the mapping
  (`declaredResources`) and the destination (`stageDest`) are exported from
  `tools/gen-staging-emit-hosts.mjs` and imported, so the guard judges the
  SAME rows store and the SAME destination the emitted BundleStager table
  stages at and cannot drift from either. The TREES test runs on the SOURCE
  path, the spelling the parsed mirror roots carry (identity dirs spell both
  sides alike; the presets' ` -> dest` tails stage INTO a vendored tree that
  does not carry those files on disk, so a source-side miss is the honest
  verdict there too). Excluded-but-TREES-covered rows
  (scenario/web-live/upstream-shims/system-plugins mirrors — all 33 real
  rows post-#797) and excluded-but-never-reached rows (dead embedded bytes)
  are not findings.
- The findings ride the existing machinery: counted by `hostFindings`,
  printed as `BLINDSPOT <file> (accessor <suffix>) — …` lines, carried in
  JSON as `results[].stagerBlindSpots`. Blocking on ios, warn-counted
  elsewhere, exactly like the other finding classes.

`iosHost` carries the face's TREES half as `stager: { mirrorRoots }` (the
store and the rows-store mapping live in the satellite). The hermetic
fixture gained both declared stores — the RESOURCES rows mapping and the
exclude store with one row of each green shape (TREES-covered ∧ reached;
not reached) — and the test net gained the counterexamples: blocked-on-ios
BLINDSPOT with exit 1 and exact JSON, both green shapes non-vacuously, and
the exit-2 referent drift. On the real post-#797 tree the gate stays green
with zero new findings, and `gen-staging-emit --check` is unchanged.

## Alternatives considered

- Emit the guard from `gen-staging-emit.mjs` (it already fails loud on
  unknown excludes) — rejected: that gate checks rows-store ↔ host-block
  agreement, not the import graph; folding a graph-reach judgment into it
  would couple two gates' failure domains, and the staging-check gate is the
  one that already owns "graph vs staging".
- Compare the exclude store against the generated `dsh:stager-rows` Swift
  block instead of RESOURCES (the issue's first sketch) — rejected: the
  block is the RESOURCES-minus-exclude DERIVATION; the conjunction the guard
  needs (embedded ∧ excluded ∧ reached ∧ no mirror) is directly readable from
  the two declared faces, and reading the derived table would re-derive dest
  mappings the table only renders.
- Map accessors through the materialized `gen_bundle_resources.py` RESOURCES
  block instead of the declared rows store — rejected: the `.py` rows carry
  no ` -> dest` tails, so the guard's destinations would drift from the
  emitted table's for exactly the rows where dest overrides exist; the rows
  store is the hand-owned source the emitter itself derives from ("the rows
  store is the only staging decision").
- Reimplement `stageDest`/`declaredResources` locally in the guard —
  rejected: a second copy of the dest remap table is exactly the
  silent-drift surface this repo's rules forbid; exporting the two functions
  is a one-word change each with byte-identical derivation.
- Treat unknown exclude suffixes as findings (exit 1) instead of structural
  drift (exit 2) — rejected: gen-staging-emit's `stagerTable` already fails
  loud on the same condition; a store naming nothing embeddable is not a
  staging gap but a face disagreement nobody can trust.
