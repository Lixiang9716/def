# Agent Note: the gateway drive's environment red: the staging row and the honest retry

Status: implemented
Related: D12, #515, #593

## Problem

The v0.0.3 release precheck (2026-10-23) found the iOS gateway drive red on
a clean main — and the red had been invisible for five weeks, because the
gateway leg is UI-driven and local-only (dev-ios CI runs boot-carrier only)
while its committed evidence was last refreshed 2026-09-28, before #593.

Two independent defects stacked, and the first masked the second:

1. **Product staging**: #593 added `import { fsPublishAtomic, fsSync } from
   '../fs-durable.js'` to `scenario/gateway-binding.js` and the RESOURCES
   embed row in `gen_bundle_resources.py`, but no row in
   `BundleStager.swift` — the last hand-maintained file-by-file staging
   list (strike four; the file documents three prior rounds). The bytes
   were embedded in SpikeBundle.c all along; the staged sandbox never saw
   the file, so every drive died at import: `cannot load module
   'fs-durable.js'`, 0 of 26 expected events, on BOTH configurations.
2. **Drive flake**: with the module staged, the drive's Files-picker walk
   proved racy on the iOS 26.5 remote sheet — one green and one red on
   identical trees the same hour. The red mode: the walk's blind `浏览`
   tap resets the sheet to the locations grid (destroying the remembered
   location that already showed `gateway-e2e`), the location cells now
   carry merged labels the walk's vocabulary lacks (`def, 2项` — the app
   is `def` since #655, and iOS 26 merges name+count into one label), and
   the remote sheet sometimes swallows WDA's synthesized tap outright. The
   scenario then waits on a file that never arrives and the 180s watchdog
   fires — an environment red that no amount of product inspection
   explains.

## Decision

Two scoped changes, one per defect:

- `BundleStager.swift` stages `fs-durable.js` beside `gateway.js`, in the
  file's own whack-a-mole ledger voice (naming the live measurement).
- `run-simulator-matrix.sh`'s gateway-drive leg applies #515's remedy in
  the shape #607 landed for m1: classify before retrying. The environment
  signature — `rt: sequence boot=PASS carrier=PASS gateway=FAIL` plus the
  picker-walk/watchdog markers in the same log — earns ONE honest retry;
  any other red is product and never retries. Attempt-1's dir moves to
  `gateway-drive.attempt1` first, so the canonical evidence path carries
  only the run that produced the recorded verdict.

## Alternatives considered

**Fix the walk itself** (in-place find before the `浏览` tap, `def,`
location-cell fallback, idb coordinate re-injection): the diagnosis is
already banked in this note and the flake evidence, and the walk is
due this repair — but it is a choreography rewrite best done against a
reproducer harness, not folded into a release precheck. Filed as the
class issue's next step.

**Retry unconditionally on any gateway red**: rejected — it would retry
product reds and can green-wash a real regression. The m1 classifier
exists precisely to keep the retry honest; the signature check here is
its narrow-leg equivalent.

**Leave the leg red and ship**: rejected — the gateway drive is the only
UI-driven proof of the full primitive binding ladder (fs roundtrip,
denials, the durable-fs pair, chunked httpFetch, picker grant, approval,
keychain, notify lifecycle); a release whose verification story skips it
repeats the exact hole the office-plane lesson names.
