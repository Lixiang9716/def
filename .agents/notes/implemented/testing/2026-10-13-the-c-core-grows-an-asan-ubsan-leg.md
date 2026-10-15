# Agent Note: the c-core CI grows an asan+ubsan leg (test-coverage row 2)

Status: implemented
Related: doc/test-coverage.md row 2 (the test-hardening program); the ten
log-verified test-core legs; `src/build.sh` (the desktop CLI proof build).

## Problem

The C spine (`src/dsh_runtime_host.c` + the socket/wasm seams) is the one
code every platform host bundles, and CI only ever proved its BEHAVIOR: the
ten test-core legs assert on structured logs, so a use-after-free, a leak at
teardown, or undefined behavior in the shared host would ship green on every
PR. No gate anywhere compiled the shared host with a sanitizer.

## Decision

- `src/build.sh` grows a third flavor: `--sanitize` →
  `runtime/dsh/build/dsh-cli-sanitize`, the SAME source/include set as the
  debug build plus `-fsanitize=address,undefined -fno-sanitize-recover=all
  -g -fno-omit-frame-pointer`, debug logging regime intact (the legs assert
  on structured logs — `-DDSH_RELEASE` would strip the evidence). It lands
  BESIDE the default binary, never over it, and `--release --sanitize`
  together is rejected loud — a no-flag build is byte-identical to before.
- `.github/workflows/c-core.yml` gains a `sanitize` job (ubuntu-24.04-arm):
  same vendored-trees cache row, materialize, `sh src/build.sh --sanitize`,
  then `cp` the flavor to the legs' hardcoded `build/dsh-cli` path inside its
  own ephemeral workspace and re-run the legs. Any sanitizer report exits
  nonzero, the leg's `set -eu` fails, the job goes red. Leak detection rides
  the job env (`ASAN_OPTIONS=detect_leaks=1`, `LSAN_OPTIONS`/`UBSAN_OPTIONS`
  `print_stacktrace=1`) — it is a runtime option, not a compile flag, because
  macOS ASan rejects `detect_leaks` outright (measured: Apple clang 21,
  "detect_leaks is not supported on this platform"), so baking it into the
  script would break the local-macOS face.
- The leg set is the plan row's documented fallback: the widest-coverage
  SUBSET that fits the 60-minute job bound. Measured on the arm64 runner
  across two CI runs (38760413938, 38778823092): upstream-boot alone ran
  51 min, and settings-surfaces spent 4 min building client bundles then
  40+ min in its scenario without finishing — both drive the built web
  client through the sanitized pump, which is the pathology. The kept five
  legs measured 15.8 min of legs + 1.2 min of build (~18 min job):
  upstream-session (deepest turn path), seam-inventory (widest single
  sweep: every product flag + every service resolver), shim-exposure-probe,
  office (zstd's heaviest path, the slowest keeper at 8.7 min),
  dsh-shell-js. Dropped: upstream-boot + settings-surfaces (the two
  measured client-driving outliers), open-design + plugin-forms (narrow
  flows the five subsume), session-preset-join-node (pure node, never
  loads the C host). The excluded legs ran clean under ASan in the local
  full-ten validation, so the gap is runner throughput, not findings.
  Local validation ran the full ten legs green under the flavor on macOS
  (leak detection is CI-only there). The plain-build teardown was probed
  separately with macOS `leaks -atExit` (shim-exposure scenario): 0 leaks —
  the LSan-on-CI expectation.

## Alternatives considered

- **A CMake option on `src/CMakeLists.txt`** (the plan row's other candidate
  entry) — rejected: the binary the legs execute is `src/build.sh`'s direct
  `cc` CLI, not the CMake `dsh-core` static lib; an option there would
  instrument a target nothing in CI runs.
- **A matrix on the existing `core` job** — rejected: it would rebuild the
  unchanged default flavor for no information and entangle two different
  postures (artifact names, sanitizer env, timeout sensitivity) in one job
  definition; two named faces read honestly.
- **A `DSH_CLI` env override in the ten legs** — rejected: ten contract
  edits on frozen leg scripts versus a one-line `cp` in a disposable
  workspace the runner throws away.
- **Local leak detection** — impossible with ASan on macOS (LSan
  unsupported; the `leaks` tool also refuses ASan processes), so the check
  lives where it works: Linux CI, with `detect_leaks=1` explicit.

## Consequences

Every c-core-path PR now pays one more arm64 job (~18 min for the five-leg
subset, under the shared 60-minute bound) and gets, in exchange,
memory-safety verdicts on the shared host with symbolized stacks. Findings
in vendored third-party TUs count the same as host findings — that is
deliberate: the closure ships as one binary. Known coverage gap: the two
client-driving legs (web-client boot + settings surfaces) are not
sanitized on CI — both ran clean under ASan locally, and re-widening the
subset (or sharding the job) is the move if the client-serving pump ever
grows its own code.
