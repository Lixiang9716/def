# Agent Note: The iOS card-player evidence leg: the simulator seat's manifest pins the presented event set without client.selected

Status: implemented

## Problem

The native card face had committed simulator/emulator proof on two of the three
hosts — Android (#454, the deterministic emulator drive) and Harmony (#455, the
native face + state seam) — but none on iOS. A fresh-install iOS device could
silently starve the card.face (the exact failure class the sibling legs gate
against: an unlisted scenario freezes on a fresh install, a missing rawfile copy
dies at copyRawFile before one scenario line) with zero committed evidence to
catch it. The trilogy's evidence net had a hole exactly where the card surface
was born (#452 made the plugin card a PiP widget on iOS).

## Decision

`test/e2e/run-ios-card-player.sh` drives DSHHost in `-dsh-mode card-player`
(Debug-only seat — Release or any `-dsh-serve` argv hits the bootRelease
fatalError) on an iOS simulator, following the sibling runner interface
(`--udid`, `--art-dir`, `--skip-build`; self-rooting from `$0`, node discovered
because the checker step needs it and the caller cannot export PATH). The drive
is marker-driven (shots on `card.present.posted` / `card.complete.posted` checked
on every loop iteration including the terminal one, plus the harmony lesson's
post-loop catch-up and an unconditional final face) and polls the log for the
verdict line with a 240s deadline — never a blind sleep. The verdict is
`test/e2e/check.mjs` against `test/e2e/scenarios/card-player.json`: 11 pinned
events, one-to-one and ordered, with **no `client.selected` pin** — the iOS
card-player seat is SessionServe+WebBootRuntimeDrive, which emits no E2E record
of its own; that pin is the Android seat's shape. The receipt
(`write-receipt.sh`) is reachable only on the green path, and the green leg
registers by the artifacts dir itself being counted by the e2e-matrix gate,
exactly like both siblings. Evidence lands in
`hosts/ios/artifacts/card-player/` (logs.txt, scenario.jsonl,
gateway-audit.jsonl, three marker-driven screens, verdict, receipt). The shared
simulator is guarded by a `/tmp/dsh-ios-e2e-sim.lock` mkdir lock (stale-holder
theft on a provably dead pid, EXIT-trap release, terminate-before-release) plus
a one-way liveness check of the older runners' per-runner `$HOME/dsh-e2e` locks.

## Alternatives considered

- **Reusing `card-player-android.json` verbatim** — lost: it pins
  `client.selected`, which the iOS seat never emits, so the manifest would be
  permanently red against a green run; per-seat manifests match per-seat
  emission shapes.
- **Asserting on the screenshots** — lost: ARCHITECTURE.md's "E2E verification"
  is by structured logs with a unique scenario-id and one-to-one expected ↔
  logged match; screenshots are artifacts for local debugging, never CI
  assertions. The checker's verdict is the only green.
- **No simulator lock** — lost: install/launch/terminate on the shared
  `org.dsh.DSHHost` interleaves with concurrent sibling legs and corrupts both
  runs; the older runners already lock per-runner, so a leg-level lock plus a
  one-way liveness check is the minimal convention-compatible serialization.

## Consequences

Fresh-worktree preconditions the leg assumes materialized (all three are the
known sync/ensure steps, not new requirements): the vendored closure and
official dist (`runtime/dsh/vendor/ensure*.sh`,
`test/e2e/ensure-official-dist.sh`, `ensure-client-bundles.sh` — the runner
itself re-materializes), the harmony rawfile closure
(`build/build.sh sync harmony` — `self-test`'s staging/bundle rejection cases
need the rawfile tree present), and a HOST-configured
`runtime/dsh/build/ish` for the `quickjs-boot-parse` gate (the desktop CLI
links those libs; a configure that happened under xcodebuild inherits
`SDKROOT=iphonesimulator` and poisons the cache — `rm -rf
runtime/dsh/build/ish` + `sh runtime/dsh/host/build.sh` rebuilds it for
macOS).
