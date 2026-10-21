# Agent Note: the node:child_process passthrough lands — and the re-baseline is deliberately not the expected clean flip

Status: implemented
Related: dsh-mobile#626 (the finding this fixes), plan §3.2 (this lands it),
the 2026-10-21 classification note (the 58 class-a rows this re-measures),
the 2026-10-20 lsp-differential note (the root cause and the rejected
alternatives)

## Problem

#626: `test/upstream-suite/smoke-hooks.mjs`'s resolve hook serves the qjs
host's runtime-modules registrations on the Node leg too, and the qjs host
registers `node:child_process` unconditionally — its shim answers
`ERR_DSH_NO_SEAM` by design. On the Node leg that meant the vendored
spawner never saw a real child process: the 2026-10-21 classification
pinned 58 of the 101 disagreement rows on exactly this.

## Decision

A module-level `NODE_BUILTIN_PASSTHROUGH = new Set(['node:child_process'])`
and one early return at the TOP of `resolve()` — before the registration
lookup, which would otherwise win every run. `{ url: specifier,
shortCircuit: true }` hands the bare `node:` specifier back so Node's own
resolver serves the real builtin. The hook only runs on the Node leg, so
the qjs leg and every host shim are untouched. Tier 2 (the remaining
`node:*` rows in runtime-modules) stays a separate decision.

## The re-baseline (the honest part)

Full two-leg rerun on a provisioned seat, compared row-by-row against the
2026-10-21 classification:

- **101 → 83 disagreement rows.**
- **21 of the 58 class-a rows flip clean to `yes`** (hooks bridge/coverage
  rows, preset rows, shell rows, skill rows, subprocess control/
  shell-activity, deliverables rows, lsp-stdio connection/host/instance/
  lifecycle, session-projection fixtures, util home-paths/lazy-require/
  native-command, bundle base/sdk-minimal, host resolver…).
- **37 former-a rows still disagree — now with REAL signatures.** The
  passthrough unmasked them: they run the real spawn and fail on their own
  merits (preset mount: the loader `internal.import` seam, same mechanism
  as the #641 inventory row; hooks: real spawn behavior under the vendored
  spawner; shell: executor semantics). These are fresh b/c triage material
  — the classification note's (a) label meant "never reached the tested
  code", and now they do.
- **+4 newly-disagreeing rows**, none silent:
  - `api__session-controller__tests__media-references.host` — the node leg
    improved to 22/0 (its old common failure was shim-caused on BOTH legs);
    qjs still 21/1, so the row now exposes a QJS-side gap. Not a
    regression — a revelation.
  - `subprocess__subprocess-local__tests__spawn-runner` — regressed for a
    design reason: the spec asserts seam-era path shapes that only held
    while the shim answered. Seam-era assertion, c/b material.
  - `subprocess__subprocess__tests__egress` — the child Node now really
    spawns and fails the ALL_PROXY assertion: newly informative.
  - `sdk__client__tests__sdk-client` — the node leg previously died at
    module load (`—`, no summary); it now runs and answers 8/35 vs qjs
    9/34: a one-test delta, newly informative.

## Alternatives considered

- **Fix inside the shim (fall back to real child_process when
  `__dshProcSpawn` is absent)** — rejected (2026-10-20): it branches
  product bytes on the environment and dilutes the hosts' honest
  `ERR_DSH_NO_SEAM` posture, which the frozen contract serves on purpose.
- **Also passthrough the remaining `node:*` rows in the same change** —
  rejected: Tier 2 changes more surface (node:vm and friends flip to
  qjs-red/node-green on known walls) and needs its own re-baseline.
- **Hold the PR until the 37+4 new-signature rows are re-classified** —
  rejected: the fix is independently correct and verified (21 clean
  flips, sanity row re-run reproduced); the re-triage is follow-up work
  that needs the fix landed to have anything to triage.

## Consequences

`test/verifications.mjs`'s node-differential reason carries the post-fix
counts. The 37 + 4 new-signature rows are an open triage list (plan:
newly recorded) — until it lands, the registry's `divergent` status
describes them. Three surprise records ride this change: the two from
the 2026-10-20 lsp seat (never committed) and one recorded today (the
sweep's freshness `npm install` step is not offline-safe on a
materialized seat; workaround: run transpile directly, then sweep).
