# SALVAGE NOTES — seat m4c (branch `feat/android-m3-ondevice`)

Audited 2026-10-12 against `origin/main` = `98869dd1bbf0cd0676ddcf6cc20535bb8481be77`
(verified current via `git ls-remote origin refs/heads/main`). Seat HEAD `f68056ae`
IS an ancestor of origin/main (branch was merged), but main has since reworked
everything spike-era: PR #402 renamed `spike/m4/m5` codenames to semantic names
(`com/dshmobile/spike/` → `com/dshmobile/host/`, `dsh_spike_m4.c` → `dsh_jni_*.c`,
assets `spike/` → `dsh/`).

## .gov content main lacks (salvage list)

### `.gov/tasks/T-0011-m3-installer-proven-on-device-through-th.json` — NOT on main

- Untracked in the seat; archived here at its relative path.
- No card with this slug on main (`git ls-tree -r origin/main .gov/tasks/ | grep T-0011`
  finds only `T-0011-cross-host-e2e-evidence-matrix-regenerab.json`, a DIFFERENT task).
- Content differs from main's T-0011 card: seat 1307 bytes / sha256 `4cb76cb6dd3e7aa3805b37cca5216faeceb76f6530d3f9a26037f43c5e749be3`
  vs main's card 2197 bytes / sha256 `6555ad112c98764893022d1b2cef5fb198f9034b857bf1722bea5e6d4c7ae85a`.
  (`cmp` differs at char 15, line 2.) Note: one earlier diff invocation in this audit
  printed a spurious "IDENTICAL" for these two files; three independent checks
  (sha256 ×2, byte sizes, cmp, title comparison) all agree they differ.
- No other card on main records this task either: `git grep -iE "M3 installer proven|m3\.android-install" origin/main -- .gov` → empty.
- Card body (the record main is missing), `status: "open"`, `receipt: null`, `id: "T-0011"`:

> **M3 installer proven on-device through the Android carrier (m3.android-install)** (created 2026-09-20)
> Checklist:
> 1. Embed the M3 canonical modules byte-identically into assets/spike (install-fetch, receipt-journal, config-layer, fixtures/dsh-badge*)
> 2. Author the thin android-specific driver scenario scenario/m3-android-install.js (canonical logic only: installFromFetch + real gateway httpFetch + negotiation + replay + notes roundtrip + config layer)
> 3. Wire the carrier fixture route + SpikeHostM3 host + MainActivity --ez dsh.m3 mode
> 4. Manifest tools/e2e/scenarios/m3-android-install.json one-to-one + run-android-full.sh phase 3
> 5. Green on emulator: m3.android-install verdict + >=2 screenshots + receipt artifacts
> 6. Regression: three-scenario suite + m4.host-binding still green
> 7. Import-closure cmp byte-identity + agent note + task exited + gov run green + PR open

## Non-.gov content main lacks (context; archived in this directory)

The whole spike-era m3 on-device install proof harness exists ONLY in this seat:

- `hosts/android/app/src/main/java/com/dshmobile/spike/SpikeHostM3.kt` — no
  `SpikeHostM3` / `installFromFetch` Kotlin wiring anywhere on main
  (`git grep -nE "SpikeHostM3|installFromFetch" origin/main -- hosts/android/app/src/main/java` → empty).
- `hosts/android/app/src/main/assets/spike/scenario/m3-android-install.js` — main's
  `hosts/android/app/src/main/assets/dsh/scenario/` has no install scenario at all.
- `tools/e2e/scenarios/m3-android-install.json` — main's `test/e2e/scenarios/` (117
  manifests) has no `m3-android-install`; its 5 install-* manifests are semantic-era
  successors (e.g. `install.carrier-evidence` asserts the same 3584-byte
  dsh-notes fixture over `dsh.runtime.log:`), so the ground is re-covered on main —
  these are the spike-era proof harness, kept for history/reference.
- Uncommitted deltas (full patch: `tracked.patch`): carrier dynamic package route
  (`/gateway-e2e/pkg/`, +25 in `spike/CarrierServer.kt`), `--ez dsh.m3` launch mode
  (+57 in `spike/MainActivity.kt`), m3 JNI entry points (+18 in `dsh_spike_m4.c`),
  runner phase 3 (+87 in `hosts/android/ci/run-android-full.sh`). All target paths
  main renamed away in #402.

## Commands this audit ran (all via `git -C /Users/lixiang/workspace/dsh-mobile-m4c`)

`status --porcelain`; `diff HEAD > tracked.patch`; `diff origin/main -- <path>` per
tracked file; `rev-parse`/`log`/`merge-base --is-ancestor HEAD origin/main`;
`ls-remote origin refs/heads/main`; `ls-tree -r origin/main` over
`hosts/android/`, `tools/`, `test/e2e/scenarios/`, `.gov/tasks/`; `git grep` on
origin/main for `SpikeHostM3|installFromFetch|onPackageGet|gateway-e2e/pkg|m3.android-install`;
byte compares via `diff`/`cmp`/`shasum -a 256` of `git show origin/main:<path>` vs seat files.
