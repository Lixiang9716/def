# Row 14: host queue-boundary concurrency stress on the D2 dispatch seam

Status: implemented

## Problem

The D2 dispatch seam — one serial JS queue carrying every host callback
(gateway settles, bus frames, session events) — had no standing concurrency
stress. The concurrent-bleed defect class (late frames landing in the wrong
turn's evidence, the bug turn-evidence.js was born from) had a fix but no
regression leg that re-creates the pressure on the real spine. Test-hardening
row 14 called for a dispatch stress harness.

## Decision

`test/panel/spine/queue-boundary-stress.test.mjs` on the spine suite
(`test/panel/spine/run.sh`, node --test over the REAL `bootUpstream` spine):
4 sessions × 4 queued turns posted as one burst with jittered SSE pacing,
then four assertions — full drain within a bounded deadline, per-session
journal attribution (each session's journal carries only its own echo),
wire-level journal contiguity, and drain completeness restated per session.

The contiguity check pages `session/page` AT the cursor
(`throughSeq: ctx.sessions.get(id).seq - 1`) and asserts the page returns
exactly `cursor + 1` records with a gapless 0-based seq ladder. `throughSeq:
-1` is the by-design empty page, so a "read everything" page must ride the
cursor; the `seq + 1`-length assert turns a silent message-windowed read
into a red instead of a vacuous pass. The follow feeds serve only as attach
receipts; the journal, not the wire frames, is the attribution oracle.

Red runs dispose the host seams via `t.after`, so a failing assert cannot
park the runner on the spine's standing watchdog timer.

## Alternatives considered

- An e2e CLI leg with a manifest/checker (the session-multi-stress shape):
  rejected — the queue boundary is in-process behavior on the serial thread;
  the panel worktree over the real spine is the cheapest real-runtime seat
  and matches the watchdog-abort-wire precedent. The e2e shape stays row 21.
- Attributing off the follow-feed frames: rejected — wire frames coalesce
  and the projection may lag; the journal is the authoritative record.
- Scaling the burst to 16×8 now: the SESSIONS/TURNS_PER constants are the
  knob; 4×4 pins the boundary without stretching a non-gated suite's wall
  time. Scale up if a dispatch-seam change ever needs it.

Cadence: rerun on dispatch-seam changes, never a gate (the spine family is
a hand-run triage suite, same as its siblings).
