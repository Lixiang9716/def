# Agent Note: the fixture seeding lands — isolation over leakage, and five leakage-blessed rows exposed

Status: implemented
Related: plan §3.17 (the b-list this shrinks further), the Tier-2 note (the
63-row table this works from), the 2026-10-20 lsp-differential note, #639
(the provision seat whose fixture subtree this corrects)

## Problem

The b-class rows' largest cluster died on missing fixture seeding: the qjs
leg's driver seeds each spec's `.fixtures.js` module into its one-runtime
staged fs; the node leg's specs read the REAL filesystem and found nothing
(preset roster `available: none`, fixture ENOENTs, EPIPE dead children).
The first seeding attempt (this seat) also surfaced the design constraint:
fixture paths are per-spec-family VFS-absolute layouts, and a naive shared
mapping leaked fixtures across concurrently running specs (measured: the
preset shipped-root row regressed on leftover system fixtures).

## Decision

`test/upstream-suite/seed-fixtures.mjs` + the node harness reproduce the
qjs contract exactly:

- **A per-process work root** `.seam-run/<pid>/runtime/dsh` (gitignored via
  the upstream-tests row) — concurrent smoke processes never share a
  namespace.
- **The staged spec runs from a COPY inside the work root**: import.meta.url
  then sits in the work root, so import-relative fixture reads land on the
  seeded bytes — the qjs model (one runtime is one spec copy plus its
  fixtures). The registered hook still serves every vendored specifier from
  the real closure; a node_modules symlink into the work root covers
  resolution for rows whose graph walks the ancestor chain.
- **Cleanup after the run**: the whole work root is removed, so nothing
  leaks into the next spec's environment.

## The re-baseline (63 → 46, +24 clean flips)

24 rows flip to yes: the fixture-seeded cluster (presets authoring/
invariant/user-root, context loader-composition, llm discovery, subagent
preset-inheritance), the staging-asymmetric a-rows (bundle ×4, experimental
agent-team ×2 + vfs-example-fixture, session-projection fixtures,
session-snapshot, skill-badge, lazy-require), and the storage/Event/tsx
faces' remaining rows (bindings.client, inspector plugin.client +
layout.host, source-chooser + load-bundle, loader-smoke ×2).

**Five rows flip to NO — every one a leakage-blessed pass**: their prior
"yes" held only while OTHER specs' fixtures/spec-siblings sat in the shared
staging tree. Under the correct isolation they fail on their own
environment: preset shipped-root (asserts the shipped posture with no
system fixtures — now honestly present/absent per spec), typert generator
type-model, experimental computer-use composition, inspector
loader-composition.host and port-selection.host (the work-root copy
narrowed their read surface). These are fresh re-triage rows with their
signatures in the run logs — recorded rather than hidden.

## Verification and its one honest gap

All 63 rows re-measured on a provisioned seat; the six b-class rows above
were verified flip-by-flip with per-row reruns before the full sweep; 49
rows across the two classification rounds were independently confirmed.
**The single-spec rerun gate again executed 0 times** (same seat-path
disclosure as the Tier-2 note); the weekly sweep (§3.16) re-anchors all
counts.

## Alternatives considered

- **Seed into a shared namespace and skip cleanup** (the first attempt,
  measured) — rejected: concurrent workers raced the flat namespace and
  three rows regressed on leftover fixtures mid-sweep; the isolation is
  the difference between a flaky and a deterministic node leg.
- **Symlink the staged spec into the work root instead of copying** —
  rejected: Node resolves module identity through symlinks, so
  import.meta.url would still name the REAL staged tree and the
  import-relative reads would keep missing the seeded bytes.
- **Force-install the shim Blob/FormData on the node harness** (instead
  of the dual-realm gate landed in #649) — rejected for the same reason
  as the Tier-2 note: it replaces native undici types under rows that
  currently pass with real transports.

## Consequences

b shrinks 18 → 12 with mechanisms named: per-family fixture-seeding
residuals (presets composition-inventory/remote/mount partials, subagent
scope), the cordis-loader internals wiring on the node harness (mount,
inventory), a node-pty vendor row (controller), and the qjs node:module
exports-entry semantics (typert). The five leakage-blessed rows are plan
§3.18-class triage material: each asserts a posture that depends on which
OTHER specs ran before it — exactly the class the isolation exists to
surface. c (17) and d (10) did not move.
