# Agent Note: the session-live respond observation precedes the answer handoff

Status: implemented

## Problem

PR #762's fs seam collapse turned CI's `android-e2e` red at
`android.session.live-read` phase 4 (run 43020422541): the checker's
one-to-one walk failed at index 24 — expected `session.list.responded`,
logged `rpc.observed credentials/describe` — while the on-device probe
still printed `PASS ... ALL PASS` and the event SET was identical
(47 expected, 47 logged).

Diagnosis: the android drive answers a CLAIMED call by parking the
connection thread until the runtime posts `api.respond`
(`CarrierAPIBridge.tryForward` → `RpcWaiter.await`). Two evidence lines
then race across two threads:

- the runtime thread, inside `SessionLiveSeam.onBusMessage`, ran
  `bridge.respondAPI(...)` (which wakes the parked conn) BEFORE
  `observeRespond(result)` (which emits `session.list.responded`);
- the woken conn thread answers the socket and immediately flushes the
  held unavailable witnesses (sorted) + emits
  `rpc.observed session.list forwarded`.

The manifest pinned the historically-winning order (responded first),
but nothing in the drive guaranteed it. The collapse's heavier runtime
boot (the `dsh-fs` cordis provider over the gateway vs the retired
in-memory `mountWorkspace`) shifted the process timing enough that the
CI emulator's conn thread won, emitting the 6-witness flush block before
`session.list.responded`. The pinned order was a race outcome, not a
construction.

## Decision

`SessionLiveSeam.onBusMessage`'s `api.respond` branch now calls
`observeRespond(result)` BEFORE `bridge.respondAPI(...)`. Both run
sequentially on the one runtime thread, so `session.list.responded` is
logged strictly before the conn thread can wake, flush, and log the
`forwarded` line — the manifest's pinned order holds by construction on
every boot, and the assertion now describes real behavior without
pinning a race. The observation is of the same event either way (the
runtime's respond bus line), so nothing is reordered semantically: the
answer still reaches the parked socket through the unchanged
`respondAPI` path, and the once-guards are untouched
(`android.session.persist-restart`, which shares this seam, does not pin
the seam window and is unaffected).

Measured: three consecutive `run-android-full.sh` phase-4 legs on the
local emulator (pixel_7 AVD, API 35 arm64), all
`47/47 events, in order`, all with `session.list.responded` at position
24 and the sorted flush + `forwarded` at 25-31.

## Alternatives considered

- Loosen the manifest (`order: "any"` on `session.list.responded`, or a
  checker `repeat` row): rejected — it weakens the one-to-one assertion
  for an event whose position CAN be made deterministic with one line,
  and the checker's `any` escape hatch is documented for records whose
  position races "by construction", which would no longer be true here.
- Pin the flipped order (flush first, responded after): rejected — that
  re-pins the same race from the other side; the next timing shift
  (a faster device, a slower GC) would redden CI again.
- Move the flush trigger off the conn thread (e.g. flush on the
  runtime thread before the answer): rejected — larger surgery on the
  seam's evidence design for no additional determinism; the sorted
  flush's own documented contract ("held and flushed SORTED at the
  first claimed call") is untouched.
