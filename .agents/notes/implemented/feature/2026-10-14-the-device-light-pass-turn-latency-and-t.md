# Agent Note: the device-light pass: turn latency and the mid-turn kill join as receipted legs

Status: implemented

## Problem

The device-facing coverage had two holes the desktop-facing legs could not
close. First, turn latency was measured as ONE number (`perf.baseline`'s
`sessionTurnMs`, over the page's write-surface wire), so a regression hiding
in the time-to-first-token phase averaged out — and the measurement had no
device seat at all, only the macOS CLI receipt. Second, the session-
persistence family proved create → force-kill → resume with the kill
landing BETWEEN turns (one complete turn per process, deliberately), which
is exactly the boundary the vendored backend handles most conservatively;
the harder real-world boundary — the process dying MID-STREAM, with the
turn open and the LLM response half-consumed — had no leg on any host, so
upstream's interrupted-turn recovery (`dsh-session`'s
`interruptedTurnClosers`) ran in production entirely unproven by our own
evidence.

## Decision

Two receipted legs join, each with a CLI simulation half (green without
hardware) and an Android device seat:

- **Turn latency** (`perf.turn-latency` on the CLI, `android.perf.turn-
  latency` on the seat): one spine turn — `agent.followup → onSse →
  whenIdle`, the path the on-device seats actually drive — segmented into
  `promptToFirstDeltaMs`, `firstDeltaToSettleMs`, and `turnMs`, emitted
  into the scenario's event stream (D8) and extracted from the captured log
  into the receipt; the manifest pins events and stable fields only, never
  a measured value. The measurement seat boots the spine BARE (no
  persistence row): it measures, it does not re-prove.
- **Mid-turn kill** (`session.persistence.midturn` on the CLI,
  `android.session-persist.midturn` on the seat): the kill turn parks at
  the FIRST streamed content delta — but only after forcing the journal's
  materialization mid-stream (`backend.flush` + `stat` non-empty →
  `midturn/durable`), and the runner's kill lands on THAT marker (a
  condition, never a clock). The stream is paced so the window is real: the
  carrier's SLOW_TURN drip on device, the node mock's `slow_success` +
  `DSH_MOCK_CHUNK_DELAY_MS` on the CLI (the plain `success` behavior
  hardcodes delay 0 — measured, and the reason the driver grew the env
  passthrough). The resume leg pins the recovery contract: exactly one
  `turn/end`, carrying `reason.kind "interrupted"` (the
  `interruptedTurnClosers` synthesis), no assistant message from the killed
  turn, then the recovery turn continues the journal (turn 2,
  `turnBoundary.lastTurn == 2`) with no `corrupt session log` and no
  `cannot resume` anywhere.

Both device seats share the ONE no-WebView Kotlin shell
(`SessionPersistRestartSession`) — entry/scenario became `start()`
parameters (defaults keep the restart family byte-identical; `onFinished`
stays the LAST parameter so the trailing-lambda call shape keeps binding
it). The Android stager's web-live embed list gains the three new entries
PLUS the restart family's three files, which were committed-but-unlisted
since #463 — an unlisted entry silently freezes on a fresh install (the
embed-list trap the stager's own comments name), so the check loop now
judges them too: a tracked source with a missing committed asset IS drift.
Both legs ran green on the android-15 emulator with receipts; the
physical-device runs remain awaiting-hardware.

## Alternatives considered

- Extracting the restart core's helpers (bus, bootPhase, waitConfigured)
  into a shared module for the midturn sibling: lost because it mutates the
  one shared file behind THREE green device legs with no physical device on
  this machine to re-verify them; sibling duplication is the family's
  existing pattern (`session-web-live.js` ↔ `session-persist-restart-
  core.js`), and the closures gate stages the new sibling explicitly.
- Killing on a runner-side timeout after the first delta (no
  `midturn/durable`): lost because the journal's on-disk state at kill time
  would be a hope, not a claim — the first delta can arrive before any
  append is materialized (measured: a SIGKILL at the first delta left the
  container EMPTY, degrading the resume to a clean create, the exact false
  pass the restart core's doc warns about). The durable marker makes the
  disk state the leg's own assertion.
- Measuring the device turn latency on the release flavor: lost for this
  pass because `-DDSH_RELEASE` suppresses the JS info stream the evidence
  rides; the receipt carries the debug-build caveat instead of a result-
  plane bridge nobody asked for yet.
