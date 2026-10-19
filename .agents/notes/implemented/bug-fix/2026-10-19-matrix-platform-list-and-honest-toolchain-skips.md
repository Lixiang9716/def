# Agent Note: the simulator matrix takes a --platform list and skips absent toolchains audibly

Status: implemented
Related: #301, the 2026-10-02 bash-invocation note (materialize()), D-g
(honest skip rule), rules.md rule 5

## Problem

Two invocation faces of `tools/test/run-simulator-matrix.sh` made issue
#301's acceptance impossible (first recorded in `.gov/surprises.jsonl`, sig
`run-simulator-matrixsh---platform-android-harmony`, 2026-10-01):

1. `--platform` took exactly one value (`platforms="$2"; shift 2`). The
   requested `--platform android harmony` died in the usage `mx_die`
   (rc 1), and `--platform` with no value died of `set -u`
   (`line 955: $2: unbound variable`, rc 1) instead of printing usage.
2. The only multi-platform form that worked — `all` = `ios android
   harmony` — dispatched platforms in a fixed order, and each platform's
   toolchain was probed only inside its own leg, by `mx_die`: on a machine
   without Xcode, `ios_platform`'s "xcodebuild not on PATH" exited the
   whole run before android/harmony ever started; a machine without adb
   died the same way at `android_preflight`. Only harmony had an
   honest-skip path (matrix-skip-receipt.json, D-g). A no-Xcode machine
   could not run android+harmony in one command.

Adjacent, same class as the 2026-10-02 fix: `hosts/ios/ci/run-shell-turn.sh`
still invoked `test/e2e/ensure-official-dist.sh`,
`test/e2e/ensure-client-bundles.sh`, and `hosts/ios/Tools/sim-preflight.sh`
—all three `#!/usr/bin/env bash` with `set -euo pipefail` — through an
explicit `sh` prefix; dash dies at runtime on `pipefail`, and macOS
sh=bash-POSIX masked it exactly as it masked materialize() before.

## Decision

- `--platform` now takes ONE OR MORE platform words (collected until the
  next flag), each validated, deduplicated preserving first-occurrence
  order; `all` still expands to `ios android harmony` and mixes with
  explicit words (`--platform all android` runs the union once).
- `platform_skip_reason` mirrors each platform's own hard guards — ios:
  `xcodebuild` on PATH plus the `DSH_E2E_UDID` simulator being available;
  android: `adb` on PATH and, when no emulator is up, the emulator binary
  plus the `DSH_ANDROID_AVD` AVD; harmony keeps its in-leg live-target
  probe — and a failed probe makes the dispatch loop record a loud
  per-platform SKIP row (`record … platform SKIP <reason> …`) and continue.
  Even an explicitly requested platform skips audibly when its toolchain is
  absent: the D-g rule generalized from harmony to every platform's
  toolchain. A config mistake (wrong `DSH_E2E_UDID`, no AVD) now reads as a
  named SKIP row naming the failed probe instead of a mid-run death.
- Exit-code contract: `--help`/`-h` prints usage and exits 0; arg-face
  errors (unknown argument, unknown platform word, `--platform` with no
  value) print the reason plus usage to stderr and exit 2 — the same
  vocabulary as the run-me-with-bash guard at the top of the file; leg
  failures keep `mx_die`'s exit 1 and the summary's non-zero return.
- `run-shell-turn.sh` invokes the three bash-only scripts with `bash` (the
  POSIX-clean `external/ensure.sh`, `external/ensure-dsh.sh`,
  `hosts/ios/gen.sh` calls keep `sh`).
- The android release leg's adb-root prerequisite is documented in the
  script header and the `--help` env note: on API 35 emulator images a
  non-root shell sees only a 4-line `/proc/net/tcp{,6}` table, so the
  uid self-connection probe starves and the leg dies "the WebView never
  fetched the carrier origin"; run `adb root` first.

## Alternatives considered

- Reordering `all` (iOS last, or alphabetical): hides the symptom — an
  explicit `--platform ios android` still died on the first missing
  toolchain, and a machine lacking adb died under any ordering that put
  android first.
- Swapping the legs' `mx_die` for `continue` when the toolchain probe
  fails: silent omission — rule 5 and D-g both forbid it; the skip must be
  a recorded row carrying the reason, visible in the summary table.
- Teaching `android_preflight` to probe `adb root` (issue #301's other
  option for the carrier-observe prerequisite): heavier and stateful —
  `adb root` mutates the emulator and errors on non-Google images; a doc
  line covers the prerequisite at zero risk. Revisit if carrier starvation
  recurs on a rootless CI image.
- A dash→bash re-exec guard inside each bash-only script: already rejected
  in the 2026-10-02 note — the guard stanza taxes every script to protect
  one call-site pattern; fixing the remaining call sites keeps the
  interpreter choice at the invocation, where every other caller makes it.
