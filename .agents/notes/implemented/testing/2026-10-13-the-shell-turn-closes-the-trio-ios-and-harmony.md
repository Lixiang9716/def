# Agent Note: the shell turn closes the trio — the iOS and Harmony seats (run-shell-turn.sh)

Status: implemented
Related: T-0216 (on-device shell verification, simulator trio); completes the
2026-10-13 the-shell-turn-proves-itself-in-the-user note, whose iOS leg was an
honest partial (the `/api` wire answered 404) and whose Harmony leg was not
attempted.

## Problem

The interactive-seat proof existed on exactly one of the three hosts. Two
questions blocked the other two. On iOS: was the previous round's `/api` 404
the seat's auth gate (the round blamed the bridge's claimed-endpoint
forwarding coupled to the page's mux lifetime), or was the installed binary
not even the serving seat? On Harmony: the user-facing RELEASE seat compiles
the drives out and the image drops `hilog.info` from non-debuggable apps —
so where does the credential enter, and how does the runner harvest the
origin token the drives normally read from the log?

## Decision

Two per-host runners, both verdict pass, added to the Android leg's
`hosts/android/ci/run-shell-turn.sh`:

- **iOS — `hosts/ios/ci/run-shell-turn.sh`.** The 404 was not an auth gate:
  the installed binary launched without arguments boots the legacy
  boot→carrier→gateway chain, whose static seat answers `/api/*` 404 "not
  found" (`CarrierRoutes.swift:30`; the live log names the
  boot.verification/carrier.loopback/gateway.binding scenarios). The runner
  relaunches the installed app with `-dsh-serve` (`AppDelegate.swift:54`)
  over container trees staged per the run-ios-live-write.sh recipe
  (`ensure-official-dist.sh` + pinned `dsh-client-modules`), which boots the
  real SessionServe seat; the token rides the `dsh.serve: origin token=`
  stderr line (`SessionServe.swift:496`). The prompt enters through the
  composer's own wire (`POST /api/session/prompt`, client-request envelope)
  with the pageSession polled from `/api/state` — the page's own id, not a
  synthesized one. The verdict is the full round trip: the mock's two
  attempts completed, the executor's fsWrite landed byte-exact on the
  container disk (12 bytes), the tool card renders expanded (screens/05),
  and the zstd journal landed (11323 bytes). The runner ran three times; two
  mid-flight fixes are folded in (the `pgrep` pattern must be
  `DSHHost.app/DSHHost`, and the pageSession must be polled — the runtime
  rejects synthesized ids with `session/not-found`).

- **Harmony — `hosts/harmony/ci/run-shell-turn.sh`.** The RELEASE
  OfficialServe seat (`startReleaseServe`, `hvigorw buildMode=release`) on
  the dsh_phone emulator. Two deviations from the Android recipe, both
  forced by measured platform facts: (1) the 0666-placeholder credential
  handshake is the llm.live-stream harness leg's channel — its validator
  demands `https://` + a ≥20-char key (`LlmConfigStaging.ets:125-128`) and
  the release build carries no E2E machinery — so the credential enters
  through the seat's own BYOK wire (`POST /api/onboarding/save`: the
  runtime validates, keychain-seals `dsh.llm/byok-route`, and rebinds the
  live transport, `runtime/dsh/upstream/web-write-onboarding.js:96-109` —
  verified `mode=byok` via onboarding/status, cleared again at exit); (2)
  the release seat's token harvest line was dead at `hilog.info` on this
  image (a non-debuggable app's info never reaches the buffer — measured by
  the release-logging leg), so this leg ships one product-line change:
  `OfficialServe.maybeOpenOrigin` logs the `dsh.serve` origin line at WARN,
  same tag, same bytes (`OfficialServe.ets:940-949`). The release seat also
  attaches no default session, so the runner creates one first
  (`/api/session/create`). Networking is hdc rport (device→host mock) +
  hdc fport (host→seat), with the runner hardened against hdc's quirks
  (`fport` exits 0 even on listen-fail — poll-verified; `rport rm` does not
  exist on this build — removal goes through two-arg `fport rm`). Verdict:
  the tool card renders in the official UI (screens/04), fsWrite landed
  byte-exact (16 bytes), the journal landed (14841 bytes), and the runner
  reproduced the turn end-to-end twice.

## Alternatives considered

- **iOS: launching the installed binary as-is and fighting the 404** —
  attempted last round, now diagnosed instead: the legacy chain's static
  seat answers 404 by construction, so no auth fix could ever green it; the
  launch-arg relaunch boots the serving seat without a rebuild.
- **iOS: synthesizing a pageSession id for the prompt envelope** — attempted
  and rejected by the runtime itself (`session/not-found`); polling the
  page's id from `/api/state` is what the page does, so the runner does that.
- **Harmony: a debug build with E2E machinery** — rejected: it re-creates
  the drive/seat gap T-0216 exists to close; the release seat with the
  BYOK wire is the seat a user runs.
- **Harmony: staging the credential as a file via hdc** — rejected: the
  app sandbox refuses shell-side creation, and the placeholder handshake is
  the harness leg's channel by construction.
- **Harmony: logging the origin line at error** — it would reach the buffer,
  but it lies about severity; warn is the honest retained level on this
  image (error/warn survive, info does not — measured).
- **One shared runner for both seats** — rejected: the stacks' harvest and
  networking are dissimilar (stderr line vs hilog; `adb reverse` vs hdc
  port forwarding with its own failure modes); per-host scripts mirror the
  Android leg's shape instead of abstracting it prematurely.
