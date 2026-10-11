# The card-player leg asserts the face through the state seam — visible=true, in-window

## Problem

run-card-player.sh's PORT/TOKEN harvest came up empty every run, so the
receipt's `stateSeam` named a state-snapshot.json that never existed. Two
layers under the symptom:

- The card-player drive seat (BindingHost) never produced the
  `dsh.serve: origin token=… port=…` line at all — the /api/state seam
  lived only on the four session seats (CarrierAPIBridge installs). The
  harvest could not succeed by construction, not merely "too early".
- Even with a line to find, the runner's single grep at step 5 ran at a
  fixed moment (the blind wait rules.md rule 8 forbids), and its `cut -d=
  -f3` read the wrong `=` field of the origin line — token extraction was
  broken independently of timing.

The seam assertion the leg existed for — GET /api/state mid-tick answers
`app.card.visible=true` — was explicitly deferred by the previous
generation's comment to "the next live generation".

## Decision

- BindingHost serves the state seam on the drive plane: one
  CarrierAPIBridge behind a per-drive SecureRandom session token, the app
  block carrying the scripted-approval flag and this drive's card face
  projection, and the `dsh.serve: origin token=… port=…` line once the
  carrier listens. The line and the snapshot fetch ride the `dsh.serve` /
  `dsh.snapshot` tags — no checker stream changes shape, and every drive
  seat gains the same observation seam the session seats already expose.
- run-card-player.sh harvests by polling the logcat dump for the origin
  line with a 120 s deadline (rule 8), forwards the port, then — the
  moment `card.present.posted` shows in the dump — curls /api/state once
  with the session cookie. The card lives until ~2.5 s after
  card.complete (the surface's own dismiss), so a probe taken at
  present-detection (+≤1 s poll granularity) reads the face mid-window.
  The token extraction reads the correct field.
- The visible=true assertion is HARD: a snapshot without
  `app.card.visible=true` fails the leg loud (a probe outside the window
  is a probe that proved nothing), and the receipt records the assertion
  (`stateSeam: {snapshot, app.card.visible, asserted}`) instead of a bare
  path.

## Alternatives considered

- Move the card-player drive onto a session seat to inherit the seam:
  rejected — the leg's subject is the NATIVE surface on the drive seat;
  grafting the drive onto SessionServe changes the subject to rescue the
  assertion.
- Assert only `attached=true` (the previous generation's compromise):
  rejected — attached is a construction fact (the surface attaches at
  boot) and proves nothing about a presented card; visible is the state
  that exists only inside the window.
- Weaken the leg to accept a missing snapshot as skip: rejected — a
  skipped assertion is an unproven leg; fail-loud keeps the probe honest
  (rule 5).

## Consequences

- The card-player leg now proves the full seam chain: bus line → native
  surface → projected face → GET /api/state mid-tick → visible=true,
  receipt-recorded (hosts/android/artifacts/card-player/).
- Every BindingHost drive gained the /api/state observation seam (inert
  unless polled; the create-card leg re-ran green on this tree).
- The manifest stays 12/12 — the seam rides no checker-stream tags.
