# Agent Note: chaos LLM mock profiles — the transport guards meet a hostile wire (test-hardening row 1)

Status: implemented
Related: T-0239; doc/test-coverage.md "Test-hardening program" row 1;
extends the loop-u2/loop-c2/ring-2 guard notes' field evidence with a
permanent regression leg.

## Problem

The three transport-guard layers (read-idle watchdog, retry pacing,
turn-watchdog) were covered only at the unit seam: fake gateways, fake
timers, scripted responses. Nothing proved their DESIGNED reaction against a
real hostile wire — the exact shapes the field batteries kept hitting
(battery-r14's black-holed socket, battery-r18's offline fast-fail reflex
that burned the retry budget in 7s). The vendored dsh-llm-mock-server has a
rich hostile script vocabulary (`stall`, `stream_eof`, `malformed_json`,
`connection_reset`, `slow_success`, …) that our e2e surface never armed; a
guard regression that only shows on real wire timing (or on the vendored
retry loop's adoption of a paced delay) would pass every existing leg.

## Decision

Chaotic profiles as PRESETS over the vendored mock's own behaviors, plus one
leg per guard layer:

- `ci/mock-llm-server.mjs` gains `DSH_MOCK_CHAOS` (truncation | slow-drip |
  malformed-sse | oversized | no-headers): each profile only selects vendored
  script behaviors / content knobs (`stream_eof`, `slow_success` +
  `DSH_MOCK_CHUNK_DELAY_MS`, `malformed_json`, a 2 MiB single-delta
  `success`, `connection_reset`) and `DSH_MOCK_SUCCESS_TEXT` /
  `DSH_MOCK_CHUNK_SIZE` are now env-exposed. Unknown profiles fail loud. The
  SSE bytes on the wire stay the VENDORED server's — the one invariant is
  "wire shape identical to the real backend; the hostile behavior is the only
  difference", and no vendored byte is edited (D6).
- `scenario/llm-chaos.js` + `test/e2e/scenarios/llm-chaos-<profile>.json`
  (four CLI legs, runner `ci/run-llm-chaos-e2e.sh`, wired into
  `build/build.sh test core`):
  - **no-headers** (`connection_reset`): the wire dies before any response
    head → FAST TRANSPORT. One run asserts BOTH upper guards: the journal's
    `llm/retry` pins `delayMs: 15000` (the retry-pacing seam's first slot,
    adopted verbatim by dsh-llm-retry's recover()) AND the turn-level
    backstop cancels the wedged turn with a watchdog cause BEFORE the paced
    retry executes (one wire request total, no `llm/retry-started`).
  - **truncation** (`stream_eof`): clean close without [DONE] →
    `STREAM_CLOSED`, non-retryable — honest turn error, no retry scheduled.
  - **malformed-sse** (`malformed_json`): `MALFORMED_RESPONSE`,
    non-retryable — honest turn error, no retry scheduled.
  - **oversized** (2 MiB single delta): the gateway byte bridge and the
    incremental parser carry it; the turn completes with the full text
    (length-pinned, never text-pinned — hostile-sized content stays out of
    logs and manifests).
- **slow-drip** (the read-idle leg) runs node-side
  (`ci/llm-chaos-read-idle.mjs`): the REAL llm-transport.js (verbatim via the
  parity node hooks) over a real async gateway, deltas flowing then a silent
  gap outlasting an 800ms budget → `TIMEOUT`, retryable BY THE VENDORED
  POLICY (`resolveRetryPolicy().retryableCodes`), with the message naming the
  watchdog and the budget.

## Alternatives considered

- **A byte-mutating proxy in front of the vendored mock** (truncate /
  corrupt / drip the stream in transit) — rejected: new wire-shaping code
  that can drift from the real backend's bytes; presets over the vendored
  vocabulary keep every wire byte the upstream mock's own.
- **Threading a `budgetMs` boot option into the mounted turn-watchdog** so
  the boot ring 2 itself could fire at 1.5s — rejected: a production config
  seam added for a test's wall clock; instead the scenario arms the REAL
  guard module (`makeTurnWatchdog` + the module's own progress feeds) at its
  contract with a 1.5s budget, and the boot-mounted ring 2 keeps its
  production 300s default untouched. Revisit only if a production config
  seam is independently wanted.
- **A CLI read-idle leg** — structurally impossible on the smoke backend: it
  drains the response body synchronously INSIDE the httpFetch call (the
  quickjs runtime is quiescent while the driver blocks in recv), so a
  mid-body stall resolves as the host's own 5s SO_RCVTIMEO + http.end
  (STREAM_CLOSED) and can never interleave with the guard's timer. Documented
  in the runner and the leg header rather than faked; the guard's logic stays
  unit-owned, the node leg owns the real-wire behavior, the device seats'
  async gateways own the full-stack shape.

## Consequences

Five profiles, five legs, every leg manifest-pinned one-to-one; a landed row
whose leg disappears is a finding (the doc's own rule). The no-headers leg
doubles as the first WIRE-level proof that the retry-pacing seam's adopted
delay reaches the journal (15000ms, no jitter) and that ring 2 bounds a
paced-wait wedge.
