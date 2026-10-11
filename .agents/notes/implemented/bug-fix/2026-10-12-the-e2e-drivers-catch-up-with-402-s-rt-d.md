# Agent Note: the E2E drivers catch up with #402's rt: drive-marker rename

Status: implemented

## Problem

PR #402 (`2dc9e7c3`, "remove the non-semantic names") renamed every iOS
drive-marker stdout prefix from `spike:` to `rt:` (AppDelegate, GatewayCore
`uiMarker`, CameraPlaneDrive, JsRuntime) but updated the log-polling drivers
inconsistently: the `ui-wait` matchers were made prefix-agnostic (they kept
working), while the TERMINAL markers became `dsh: sequence` /
`dsh: device-plane drive finished` / `dsh: ui-wait <surface>` — prefixes the
app has never printed (pre-#402 `spike:`, post-#402 `rt:`). The result: the
app completes the whole scenario and prints `rt: sequence boot=PASS
carrier=PASS gateway=PASS`, the driver never sees its marker, polls to its
900 s deadline, and fails a fully-passing leg. Measured live 2026-10-12
00:18: the gateway-binding scenario ran to `scenario.complete status:pass`
and the driver still expired with "'dsh: sequence' never appeared" (matrix
log /tmp/dsh-matrix-ios.log). Every ios harness leg has been un-runnable
since #402 (Oct 7); the committed green evidence predates it (Sep 30, #281).
The same staleness extends past the failing leg: the release tripwire
asserts zero `dsh:` markers (vacuous since the rename — a release build that
regressed into printing `rt:` drive machinery would pass), dev-ios.yml's CI
poll and notices grep `dsh:` strings the app never emits, and seven sibling
drivers wait on `dsh: sequence <phase>=`.

## Decision

The drivers match what the app actually prints (`rt:`-prefixed, verified in
hosts/ios/App/Source): run-ios.sh's terminal marker is `rt: sequence boot=`
(phase-specific, the persist-restart driver's post-#463 convention), the
device-plane driver's four matchers are `rt: ui-wait clipboard-read|share`
`/picker` and `rt: device-plane drive finished` (the shared
`GatewayCore.uiMarker` prints `rt: ui-<phase> <name>`), dev-ios.yml's poll
and notices grep `rt: (sequence|ui-wait)`, and the release tripwire asserts
zero on the `rt:` variants (sequence, ui-wait, app launched, device-plane /
gateway / host drive finished, verdict) instead of the dead `dsh:` strings —
measured zero `rt:` markers in the release captures before tightening, and
the rerun's release leg proves the tightened tripwire stays green. The fix
unlocked the checkers for the first time since #402 and they immediately
caught a SECOND stale mirror: the `descriptor.declared` manifests pin
`available: 33` while GatewayCore.primitives has carried 35 names since
#427 landed the timer seam (`timerSchedule`/`timerCancel` — the #382/#395
iOS twin); `gateway-binding.json` and `device-plane.json` now pin 35
(proven: the rerun's gateway-binding verdict failed on exactly that field,
expected 33 vs logged 35, 18/19 other events matching). Proven by a full
ios matrix rerun (release + gateway-drive + device-plane, all green).
Seven sibling drivers NOT in the matrix still carry the stale
`dsh: sequence <phase>=` terminal markers (install-ui, live-llm,
live-session, live-write, next-web-mount — which additionally needs the
`next-web=` → `v2-web=` phase rename, official-web-mount, session-mock-llm);
they are reported, not edited, because no run in this task exercised them.
Other descriptor-count manifests not exercised by the ios matrix legs
(mic-plane, camera-plane-capture, ios-ble*) still pin pre-timer counts and
need the same catch-up when their legs next run.

## Alternatives considered

- Change the app back to printing `dsh: sequence`: rejected — #402's whole
  point was removing the non-semantic `spike:` name, and `dsh:` on
  app-internal stdout markers adds nothing the `rt:` prefix (the app's
  actual identity, "DSH runtime") doesn't already carry; renaming product
  output to satisfy test scripts inverts the dependency.
- Match the generic `rt: sequence` instead of `rt: sequence boot=` in
  run-ios.sh: workable but loses the phase pin — the default launch ends at
  exactly one sequence line, and the phase-specific token (the convention
  the post-#463 persist-restart driver already uses) fails loud if a future
  rename silently changes the marker again rather than matching any
  sequence-shaped line.
- Also edit the seven sibling drivers in the same pass: rejected for now —
  each is a live UI drive that only a real run can prove, none runs in this
  matrix, and shipping unproven edits to UI drivers repeats the exact
  failure mode under repair (markers edited without a live run). They are
  one mechanical line each, listed above with their exact replacements.
