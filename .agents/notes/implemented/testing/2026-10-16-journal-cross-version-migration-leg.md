# Journal cross-version migration leg (test-hardening row 8)

Status: implemented

## Problem

The persistence journal's schema-migration behavior — a journal written by a
previous Session format generation being read, replayed, and appended-to by
the current build — had no regression leg in this repository. The upstream
dsh-tests suite covers the format codecs, but only inside the QuickJS
sweep (weekly, informational); the repo's own session legs (composer-journal,
session-delete, the e2e restart scenarios) all start from current-format
journals. The exact contract this leaves unpinned: which cross-version
replays are compatible, what the migration does to the stored bytes, how a
corrupt line is treated, and what happens when a future build's journal
shows up. T-0208/T-0209 (the "empty history" incidents) showed how expensive
it is to triage journal questions without a green/red answer machine.

## Decision

`test/panel/spine/journal-migration.test.mjs` pins the contract against the
VENDORED `@deepseek-ai/dsh-session-persistence-jsonl` bytes (pin
0.1.6-alpha.2) on real disk, under plain `node --test`:

- fixtures hand-built to the released v0 and v2 physical layouts (the
  codecs' own key tables; v0 = suffix-only filename, no stream; v2 =
  `isSeeded` header, embedded assistant stream, `surfaceOp:"append"` on
  surface rows);
- a historical journal write-opens THROUGH the migration: the full turn
  replays dense and complete, the v2→v3-synthesized system head is asserted
  at the first step (id `v2-to-v3-system-<sha256>`), appends land in the
  published `session.v3.jsonl`, the source generation stays byte-identical,
  and a fresh storage instance (the restart) reads everything;
- a corrupt TAIL line is skipped honestly: committed prefix reads complete,
  the repair warns through the logger, the next write truncates the tail;
  a corrupt line INSIDE a turn refuses the read outright;
- a future header version (v4) refuses with the
  "written by a newer harness — upgrade the harness" wording, artifact
  byte-identical; unknown event vocabulary refuses unless the row carries
  `ignorable: true`, in which case it is retained opaquely and the journal
  stays appendable; an unknown field on a known row refuses loudly.

Two files make the imports work: `journal-resolution.mjs` (the leg's
resolution layer — farm + `external/node_modules` prerequisites, plus two
override rows at a closer ancestor: the REAL vendored
`dsh-session-persistence` package instead of parity's stale errors-only
shim, and the `node-addon-system/flock` single-process shim instead of the
native addon) and a second, hook-less invocation appended to
`test/panel/spine/run.sh` (which also now provisions
`parity-node-modules.sh`).

## Alternatives considered

- **Panel vitest suite (the CI-wired gate).** Rejected: the vendored graph
  resolves bare imports through the vendored trees' real ancestor chain —
  vitest would need new aliases in `vitest.config.js` for the whole
  session-format family, and the aliases would pin untracked paths.
- **Riding the spine loader hooks (one run.sh line).** Rejected: the hooks
  remap `node:fs` for every module under `runtime/` — which is where the
  vendored packages realpath — onto the workspace VFS; the jsonl backend
  needs real-disk durability, and its migration verification runs in a
  worker thread on real bytes. A journal leg that only holds on the VFS
  would prove the wrong contract.
- **Only asserting the format chain (no jsonl storage).** Rejected: the
  generation publication, immutability, torn-tail repair, and the
  upgrade-the-harness refusals live in the storage layer; a format-only leg
  would miss exactly the cross-layer behavior row 8 names.
