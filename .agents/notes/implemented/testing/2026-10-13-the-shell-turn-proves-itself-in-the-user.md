# Agent Note: the shell turn proves itself in the user-facing seat (run-shell-turn.sh)

Status: implemented
Related: T-0216 (on-device shell verification, simulator trio); extends the
2026-10-11 seat-switch and 2026-10-13 standing-loop notes.

## Problem

The shell seat's proofs were all executor-side: the CLI e2e leg drives
`ctx.tools.execute` directly, the panel suite drives a shim — nothing
proved the INTERACTIVE path a real user takes (prompt in, model emits a
shell call, the tool runs inside the app, the card renders). The calendar-
live leg had the right shape but required a real-model credential, and the
debug harness build boots a drive selector, not the seat a user runs.

## Decision

`hosts/android/ci/run-shell-turn.sh` — the T-0216 simulator leg:

- the **RELEASE** SessionServe seat signed with the debug keystore (the
  page-open recipe): drives are compiled out, so what boots is exactly the
  user-facing app; `run-as` cannot reach it, so the mock credential is
  root-staged (emulator-only posture) and removed on every exit path;
- the vendored mock's `tool_call_success` behavior pointed at the one
  `shell` tool through `adb reverse` loopback — zero mock code changed;
- the prompt enters through the **composer's own wire** (`POST
  /api/session/prompt`, client-request envelope, the session token the
  WebView's load URL carries into the logcat capture) — the identical
  request the page sends, not a synthetic drive;
- the verdict is the full round trip: the mock's two attempts completed,
  the executor's fsWrite landed on the container disk with the exact
  bytes, and the rendered tool card is on the screenshot.

## Alternatives considered

- **A drive extra (`--ez dsh.shellturn`) like calendar-live's** — rejected:
  a drive boots the spine inside a scenario harness, which re-creates the
  gap; the whole point of T-0216 is the seat a user actually runs.
- **A real model turn** — deferred, not rejected: the calendar-live
  credential ladder covers it; the mock proves the seat's plumbing
  credential-free today, and the leg accepts DSH_CRED-style wiring later.
- **UI-automation typing into the WebView composer** — attempted and set
  aside: UIAutomator cannot focus the WebView textarea reliably; the wire
  POST IS the composer's request (frozen envelope, webserver-contract),
  so nothing synthetic is asserted.
- **iOS/Harmony in the same round** — partial: the iOS seat boots and
  serves (screenshot committed) but its `/api` wire did not answer curl —
  the bridge's claimed-endpoint forwarding appears coupled to the page's
  mux lifetime; that is its own follow-up. Harmony (hdc + dsh_phone) is
  not attempted this round.
