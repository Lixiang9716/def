# Agent Note: the iOS stager's per-file rows become generator-spliced — the last hand staging list retires (#667)

Status: implemented

## Problem

`hosts/ios/App/Source/BundleStager.swift` staged the embedded JS bundle
file-by-file through a THIRD hand copy: ~103 `try write("rel", data:
resData(accessor), ...)` calls unrelated to the rows store
(`tools/generated/staging/ios-RESOURCES.rows`) that already owns the
embedder's accession table. A missed row died on-device as
`cannot load module` — four strikes in as many weeks (the owner's first
Release run 2026-10-08, create-card 2026-10-11, the transitive face layer,
fs-durable.js on the v0.0.3 precheck 2026-10-23, #666's fix), and the
class was still alive: on 2026-11-13 the T-0299 face made
`upstream/boot.js` statically import `upstream/boot-permission-presets.js`
(→ `upstream/permission-presets-data.js`), whose RESOURCES embed rows
landed with the feature while the stager's write list — a separate hand
edit nobody remembered to make — did not. Android and harmony stage both
files from their mirrors; the next iOS serve boot would have died on the
first unresolved import. Nothing static related "resources the generator
embeds" × "modules the staged graphs import" × "rows the stager writes",
so CI (boot-carrier only) stayed green for as long as it took.

## Decision

The per-file staging list is DERIVED and machine-spliced, same shape as
the android stager's for-in splice and the harmony Index.ets
BUNDLE_FILES splice (D5's contract-first discipline applied to the
staging manifest; D17's build facade stays the executor):

- The emitter's ios leg (`tools/gen-staging-emit-hosts.mjs`) derives the
  staging table = every `ios-RESOURCES.rows` row MINUS the new hand-owned
  `ios-stager.exclude.rows` (the rows whose bytes reach the device another
  way: the drive-eval scenario accessors, the spine-TREES-mirrored shims
  and system-plugin dirs). DEFAULT-INCLUDE is the point — a new embedded
  resource stages without a stager edit, so the forgotten-write class
  cannot recur; a row joins the exclude only as a reviewed hand decision.
- Destinations derive mechanically from the row's SOURCE rel
  (`stageDest`): `../../external/x` → `vendor/x`, `repo:presentation/
  web-client{,-mini}/x` → `webclient{,-mini}/x`, `repo:` stripped, bare
  rels identity — with one escape hatch: an explicit ` -> <dest>` tail on
  a row (the two agent-presets preset tables, whose DSH-rooted
  `presets-mobile/` mirror stages INTO the vendored package). The table
  is dest-sorted — the sorted table is THE table.
- The table splices into `BundleStager.swift` between
  `// dsh:stager-rows:begin/end` markers as a `[StagedRow]` of
  (destination, accessor) pairs; `stage()` walks it with one write loop.
  `--check` fails on any drift, `--emit` heals; a hand-edited row is
  drift, the rows store is the only staging decision. A destination two
  rows derive to, and an exclude row the store does not have, are
  structural failures (exit 2), never silence.
- The tree embeds (spine TREES, the webclient tree) and the
  Documents/upstream-tests lift stay programmatic — they enumerate by
  existence and cannot drift; the table covers exactly the per-file
  RESOURCES rows.

Net effect on the tree: the 103 hand rows are reproduced byte-for-byte
(dest + accessor), PLUS the two rows boot.js gained on 2026-11-13 —
`upstream/boot-permission-presets.js` and `upstream/permission-presets-data.js`
now stage on iOS, closing the strike-four-class miss BEFORE any device
run saw it. No rows file row was renamed or dropped.

## Alternatives considered

- Embed-by-existing for the bundle root (issue #667's option 1): make the
  runtime/dsh root level a TREES tree so files stage by existing. Rejected
  here — the root mix is heterogeneous (repo: plugin rows, external/
  vendored rows, web client dirs with renamed roots); a whole-root tree
  would stage files iOS deliberately does not ship today and needs the
  accessor column anyway for the drives. The exclude-list derivation gets
  the same no-list-edit property with per-row review kept.
- A static importer-graph check only (issue #667's option 2): verify every
  reached import has a write row. Kept implicitly — check-staging's ios
  surface still blocks ahead of this gate — but a check alone still leaves
  the THIRD hand list for the next human to forget; the derivation deletes
  the list instead.
- Destination overrides fully in the emitter as a policy map: rejected —
  a destination that differs from the source rel is a staging decision and
  belongs in the hand-owned rows store, reviewable in the diff, not as
  emitter magic.

## Consequences

- A new iOS RESOURCES row now stages automatically on the next
  `gen-staging-emit --emit`; its reviewer must confirm the destination
  remap is what the loader resolves (bare rels and the two mechanical
  remaps cover the existing shapes).
- The staging gate now guards four ios artifacts (RESOURCES py, TREES py,
  BundleStager markers, the rows files themselves); the committed Swift
  block is machine-owned — edit the rows store, run --emit, commit.
- The gateway-leg CI-home item of #667 (a runner that would have caught
  the 2026-11-13 miss the moment it landed) remains open — this note's
  fix removes the hand list, not the CI blind leg.
