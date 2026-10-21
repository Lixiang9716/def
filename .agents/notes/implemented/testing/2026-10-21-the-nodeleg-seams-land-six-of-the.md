# Agent Note: the node-leg seams land six of the eighteen b-rows

Status: implemented
Related: plan §3.17 (the re-triage whose b-list this shrinks 18 → 12), the
2026-10-21 Tier-2 note (the final class table this works from), #645/#647
(the passthrough tiers), the 2026-10-20 lsp-differential note

## Problem

The Tier-2 re-triage left 18 rows classified (b): the node harness lacked
faces and seams the qjs leg's driver provides, so those specs died before
their assertions. Each row's mechanism was named; this seat lands the
mechanisms that were provable without touching product bytes.

## Decision

Three seams in the node harness (`test/upstream-suite/smoke.mjs`), all
matching what the qjs driver (upstream-suite-leg.js) presents:

- **The shim DOM classes, presented explicitly.** The only-when-absent
  installers (installWebEvent et al) keep Node's native Event family, so
  specs constructing `new Event(...)` failed the product shim's
  instanceof gate (web-dom.js:230). The harness now assigns the shim
  Event/EventTarget/CustomEvent/MessageEvent/ErrorEvent/CloseEvent
  directly — the same classes the qjs leg serves. Storage has no Node
  native counterpart, so installWebStorage() alone covers
  localStorage/sessionStorage/Storage.
- **The tsx-face host intrinsics**: `__dshChildProcessNs` is the REAL
  `node:child_process` namespace (honest after the passthrough — the
  fs-readdir.js real-builtin-first precedent) and `__dshProfileTmpdir` a
  scratch dir under the staged tree, with `process.chdir(runtime/dsh)` so
  the tsx discovery's cwd contract holds.
- **FormData accepts either realm's Blob** (web-fetch-forms.js
  #normalized): on Node the vendored clients construct the native Blob
  while the shim FormData face checked `instanceof` against the shim
  class — a two-face mismatch that killed the DeepSeek files uploads
  before their assertions. qjs is single-realm and unaffected.

**Measured: 63 → 58 disagreement rows; +6 clean flips, zero regressions,
zero c/d movement**: api terminal-controller bindings.client,
experimental inspector plugin.client, experimental webworker-runtime
source-chooser AND load-bundle (a bonus — the shim Event family unmasked
it too), test-support loader-smoke ×2 (the tsx face).

## Alternatives considered

- **Land the fixture seeding in the same change** — attempted and
  WITHDRAWN. The naive mapping (seed-path minus leading slash under the
  staged tree) wrote a nested `upstream-tests/upstream-tests/` tree: the
  fixture paths are per-spec-family VFS-absolute layouts (`/fixtures/…`
  for subprocess, `/upstream-tests/fixtures/…` for presets/context), and
  the correct node mapping needs that per-family path map designed
  first. Only the subprocess row was accidentally fed, and it still
  failed on a deeper import; no measured value was lost by withdrawing.
- **Force-install the shim Blob/FormData globally on the node harness**
  (instead of the dual-realm gate) — rejected: it would replace the
  native undici types under rows that currently pass with real
  transports (the 25 Tier-2 flips), risking regressions in the exact
  population Tier 2 just won.

## Consequences

b shrinks 18 → 12, each remaining row with a named need: per-family
fixture-seeding design (context, llm discovery, presets ×6, subagent,
inventory — the largest cluster), the cordis-loader internals wiring on
the node harness (mount), a node-pty vendor row (controller), and the
qjs node:module shim's exports-entry semantics (typert — the one
qjs-side fix). c (17) and d (10) did not move, as required. The
`FormData` dual-realm acceptance is a product-shim robustness change
that is qjs-inert (single realm there).
