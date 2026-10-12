# Agent Note: the simulator matrix's harmony leg goes real - the honest-skip section grows the harness ladder and the release leg

Status: implemented

## Problem

The matrix's harmony section could only write skip receipts: on a machine
with a live hdc target it died loud demanding "wire the real leg instead of
skipping", and on every other machine it recorded a skip. So the
"release-grade three-host matrix" was a two-host net everywhere the harmony
emulator existed, and T-0219's item 3 ("Harmony platform leg green") stayed
untick by design — the #466 re-run carried a skip receipt, not a green one.
Closing that card honestly required the leg to exist, not another skip.

## Decision

`tools/test/run-simulator-matrix.sh`'s harmony section now runs the real
legs when a target is up and keeps the verbatim skip receipt when not:

- **harness leg** — `hosts/harmony/ci/run-host-e2e.sh` into
  `simulator-matrix/harness/` (the 8-checker ladder: regression trio +
  capability binding + the four D9 phases), receipts on the green path only.
- **release leg** — `hosts/harmony/artifacts/release-logging/run.sh
  --skip-harness` with `DSH_RELEASE_LOGGING_ART` landing the evidence in
  `simulator-matrix/release/`, plus a `release-proof.json` in the matrix
  shape. The first wiring runs caught the release prover's accumulated
  stales: the bundle id (com.dshmobile.spike — the app is
  com.dshmobile.host everywhere since #402), the sink tag
  (`dsh.spike.log:` — the canonical prefix is `dsh.runtime.log`,
  dsh_runtime_host.c), and the serving proof itself: on this image a
  release build's hilog.info never reaches the buffer (hilog.error does —
  the refusal is proven by name in the log), so the 09-21 run's three
  info-level serving-fact awaits are unobservable in a release window. The
  serving proof is now socket-level — the serve's own LISTEN row on 17890
  (`/proc/net/tcp*` state 0A), then the auth-lite gate answering
  `GET / -> 401` through an `hdc fport`, the same shape the android release
  leg probes through adb forward; the screenshot carries the rendered UI.
  The asserted-zero set is the drive machinery (verdict/result text,
  ALL PASS/FAIL) plus the debug/info logger levels — deliberately NOT the
  whole `dsh.runtime.log:` stream, which a release build legitimately
  carries (warn/error ride RELEASE_CRITICAL_LEVELS).
- **ORDER IS THE NATIVE TRAP**: the harness leg runs BEFORE the release leg.
  The release leg cleans `entry/build` + `entry/.cxx` before its build
  (recorded surprise `harmony-native-cross-mode`: hvigor's buildMode does
  not reach the native output path, so a post-release debug build packs the
  release `libspike.so` and the harness captures come out empty). The legs
  are hardcoded to that order with the trap named in place.
- `capability-skips.json` follows the iOS/Android shape (driver probe:
  hdc + the on-device drives; the standing no-emulator-hardware rows).

First runs on the dsh_phone emulator (HarmonyOS 7.0.0.106, 127.0.0.1:5557):
the harness ladder green 8/8 with its green-path receipt, the release leg
green on the socket probe + refusal — the evidence set that closes T-0219
items 3/5. The harness leg's first runs also caught three scenario-pin
drifts nothing could see while the leg was dead (official descriptor 8/3 →
13/1; binding table 28/9 → 31/9; the spine roster +`plugin_create` with its
count field 30 → 31) — re-pinned against the committed host sources.

## Alternatives considered

- Land one-off evidence from ad-hoc commands and leave the section
  skip-only — lost: no standing producer; the next `--platform all` run
  would write a fresh "skipped" receipt next to live evidence dirs, an
  incoherent state the walk-anything gates would flag.
- A harmony-only driver outside the matrix — lost: fragments the single
  net the matrix exists to be, and re-implements the boot/poll/receipt
  discipline the per-leg scripts already carry.
- Write a new release prover for harmony — lost:
  `release-logging/run.sh` already proves exactly the release leg's
  contract (zero-marker asserts over the full hilog window, serving facts
  polled, refusal by name); forking it would drift two copies of the same
  assertions.

## Consequences

`--platform all` with a booted dsh_phone now spends ~40 extra minutes on
harmony builds and drives. Machines without the CLT or a booted target are
unchanged (same skip receipt as before). The release leg re-uses the
release-logging assertions rather than the iOS/Android zero-count shape —
its `observedNotAsserted` row (gateway audit / warn records) does not
apply: harmony's release asserts the strict zero set over the full window.
