# Agent Note: the shim tables wire on the node harness — and the final 46-row surface

Status: implemented
Related: plan §3.17 (the re-triage this advances), the Tier-2 and
fixture-seeding notes (the 63→46 arc), #626/#647 (the passthrough tiers),
dsh-mobile#626

## Problem

The node harness never executed the shim tables: nothing in its import
chain imports `runtime-modules.js` or `npm-bridges-c.js`, so their
`__dshModuleDefine` rows never registered on the node leg — the specs
resolved the RAW vendored packages. Measured on the cordis-plugin-loader
family: the preset mount row's `scoped.loader.internal` was undefined
(the vendored lib's no-internals path) and the inventory's
`internal.import` was missing, versus the qjs leg where boot.js imports
the tables for exactly this.

## Decision

`test/upstream-suite/smoke.mjs` imports
`runtime/dsh/upstream/shims/runtime-modules.js` and
`npm-bridges-c.js` explicitly at startup (after installing
`__dshModuleDefine`, before the spec) — the qjs boot's own contract.
Registration files then exist for the whole table + bridges family
before the spec loads, and the hook serves the subclassed
cordis-plugin-loader with a working `internal.import`.

The typert row's qjs-side resolve face also gained real-Node semantics:
`makeResolveFace.resolve()` now answers the package ENTRY (main, via the
bundle-read seam) instead of the manifest path, whose import dies on the
host loader. Kept despite not flipping its row (see below): answering
the entry is real-Node semantics, and the manifest answer remains the
fallback for unreadable manifests.

## Measured

The full sweep is **46 disagreements — unchanged from the fixture-seeding
state**. The wiring's value is inside the rows: preset mount went
14/39 → 51/2 and inventory from all-fail to 9/3 (more tests executing
per row), but their agree cells stay NO — the remaining failures are
deeper edges (an Include-based loader also lacking internals; fixture
bare packages outside the seeded set). typert stayed 17/0 node vs 8/9
qjs: the resolve-face fix reads the manifest through `__dshBundleRequire`
(real bundle bytes), which cannot see workspace-STAGED fixture
manifests — flipping it needs the staged-fs read seam instead. Attempted,
measured, kept for its semantics, honestly not a flip.

## The final 46-row surface

41 rows from the §3.17 re-triage (the loader-internals/fixture edges
above, the node-pty controller row, the c-class runtime deltas, the
d-class capability rows) + the 5 leakage-blessed rows. Every remaining
row names a mechanism or a staging asymmetry; the triage queue is the
runtime work queue now.

## Alternatives considered

- **Wire `cordis-plugin-include` internals the same way** — the mount
  row's remaining failures implicate the Include-based loader too; this
  seat lands the tables wiring (which serves whatever the bridges
  register) and leaves Include-specific internals for the next round
  with its own re-baseline.
- **Read the staged manifest via the shim fs** (instead of
  `__dshBundleRequire`) — the correct fix for the typert row; deferred:
  it changes what the resolve face can answer mid-bootstrap and needs
  its own measured round.

## Consequences

The node leg now registers the full shim table + bridges family — any
future row that needs a registered face gets it for free. The 46-row
queue: loader-internals edges (mount/inventory), node-pty vendor row
(controller — owner decision on a native addon pin), the qjs
staged-fs manifest read (typert), the 5 leakage-blessed rows, and the
c/d populations.
