# Agent Note: vendoring-repro paths scope + the leak case's honest failure lines

Status: implemented

<!-- task: T-0262 -->


## Problem

The `vendoring-repro` gate (the multi-minute fresh-clone vendor proof) had no
`paths`, so every `gov run`/CI change re-proved the whole vendor closure — a
docs-only edit paid the full proof. Separately, the staging leak case's
failure lines could lie by omission: bare `if !` consumed the checker's real
exit code (drift-1 / structure-error-2 / SIGKILL-137 all read as one
undifferentiated red), an empty residual file rendered as a dangling
"residual gate output: " tail (the tool died before speaking — it read like
a format accident, not a diagnosis), and a residual failure said nothing
about the tmpfs the residual file lives on, although a full `$TMPDIR`
reproduces exactly the zero-output death signature.

## Decision

- `gates.json`: `vendoring-repro` carries `paths` = `external/**` +
  `runtime/dsh/ci/parity-node-modules.sh` +
  `runtime/dsh/ci/check-parity-resolution.mjs` +
  `runtime/dsh/upstream/shims/dsh-session-persistence.js` — the
  closure-honest trigger set: the proof re-runs when the vendor scripts, the
  parity checker, or the shim they install change. Sealed by the plane ritual
  (T-0262; UNATTENDED consent recorded in `.gov/rituals.jsonl`).
- `.gov/rejections/case-staging-generated-webclient-leak.sh`: every failure
  line now records the real exit code (`rc=0; node … || rc=$?`, including
  inside the preflight settle-retry), names an empty residual out loud
  ("residual output: <empty> — tool exited with no output; environmental
  suspect"), and appends `df -h "${TMPDIR:-/tmp}"` on residual failure. The
  pass path is byte-for-byte behaviorally unchanged (20x loop green).

## Alternatives considered

- Widening `paths` with `runtime/dsh/upstream/**` /
  `tools/generated/staging/**`: rejected — those trees are already owned by
  staging-check/staging-generated, and the proof judges a given tree without
  reading them; the trigger set is the proof's own inputs and consumers
  (`parity-node-modules.sh:107`, `reproducibility-proof.sh:157`).
- Covering `gates.json` itself in vendoring-repro's paths: impossible
  (self-reference); the plane gate owns it (gates.json is in plane's paths).
- Toolchain (GNU tar vs gtar, node) and upstream network state stay honest
  gaps: they are environment, not paths — a runner-image flip can flip the
  verdict at zero diff. Accepted and documented on the gate.
- For the case: keep `if !` and read `$?` in the then-branch — impossible;
  there `$?` is the negation's 0. That swallow was the defect.

## Consequences

- Docs-only changes stop paying the proof in base-scoped selections
  (`gov run --base`, pre-push scoping, CI's checkout-shaped selection).
- A local full `gov run` without `--base` still executes every mode gate and
  only annotates scope ("N file(s) in scope") — the skip lives in the
  base-scoped selection, not in the unscoped run.
- The case's red legs are diagnosable from govrail's single quoted line:
  exit code + residual head + disk state.
