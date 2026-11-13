# Agent Note: the iOS page-open pin — the release seat's interactive boot gets a CI guard (#691)

Status: implemented
Related: D8

## Problem

The android page-open pin (loop-t) is the only CI leg that cold-boots an
INTERACTIVE seat, and it earned its keep catching #686 — an interactive-only
boot failure invisible to every evidence drive. iOS had no equivalent: the
ios-e2e legs boot evidence drives (non-interactive configs), so the
interactive release seat (`AppDelegate.bootRelease` → `SessionServe`,
interactive: true — the boot every actual user runs) was CI-blind to exactly
that failure class. The blind spot was not hypothetical: on the same day the
iOS twin landed, its first local run caught the release boot failing at
web-boot eval with `cannot load module 'upstream/boot-permission-presets.js'`
— the bytes were embedded (gen_bundle_resources carries the row) but
`BundleStager` never staged them to the runtime tree, while android/harmony
(stage whole directories) and every m1/evidence drive stayed green.

## Decision

`hosts/ios/ci/run-page-open.sh` — the iOS twin of the android pin, mirroring
its assertion shape 1:1 at the honest iOS altitude: fresh boot of the DEFAULT
seat (launch with NO arguments — the release gate refuses drive modes by
fatalError), then the serving origin is asserted from the two channels that
survive the release log regime (`-DDSH_RELEASE` strips logger debug/info;
NSLog lines and socket state survive):

1. the serving-origin line `dsh.serve: origin token=<32 hex>` from the
   simulator's unified log (the iOS logcat; `maybeOpenOrigin`'s NSLog — the
   boot passed the `web.boot` + `settings.probes.done` page-open gate);
2. the carrier's bound port read from the app process's own socket table
   (lsof, exactly one 127.0.0.1 LISTEN) — the iOS origin line carries the
   token but not the port (the android sibling logs both), and a boot-time
   port is a measured fact, not something to add a log line for;
3. GET `/api/state?token=<token>` polled until 200 with the bridge
   snapshot's `claimedEndpoints` + `app` block present (the diagnostics seam
   the android release-seat leg asserts);
4. page-open evidence: a connection to the carrier port that PERSISTS across
   two polls (the page's mux session — the script's own curl is transient)
   plus page-driven token-authed `/api` traffic beyond the script's one
   probe — there is no WebView devtools on iOS, so these are the honest
   page-navigated proxies;
5. zero failure lines from the boot window (`runtime failed` /
   `bootstrap failed` / `FAIL ` — all NSLog channels), scanned with an
   early-exit so a fast-failing boot reds in seconds instead of burning the
   deadline.

Every wait is a polled condition with a deadline; a machine with no >= 26
simulator runtime SKIPs loudly (exit 0 + `::warning::`, the sim-preflight
class — the runtime pairing is a precondition the leg was not handed, not a
product verdict). The leg joins `.github/workflows/dev-ios.yml` INSIDE the
existing `ios-e2e` job (same check name — no new entry in ci-verdict.yml's
EXPECTED list, no branch-protection change), as a gating pair of steps
(build Release .app, then run the pin) positioned after the boot-carrier
attempt loop, mirroring the android workflow's release-build + page-open
step block. Evidence lands under `hosts/ios/artifacts/page-open/`
(boot-window log corpus, seam body, screenshot as LOCAL debugging evidence
only, machine-authored `receipt.json` stamped with `runId` under CI so the
Report-verdict provenance check reads it like every other verdict).

## Alternatives considered

- **A dedicated job in dev-ios.yml.** Loses: a new check run name would
  require adding it to ci-verdict.yml's EXPECTED list in the same PR, which
  touches branch protection (#665 cold-seat precedent) for no coverage gain —
  the step gates the same merge either way. Inside `ios-e2e` the check name
  set is unchanged.
- **Asserting the WebView's navigation through a new host-side log line**
  (an NSLog in `hideBootOverlay` or the navigation delegate: "the page
  rendered"). Would be the strongest page-open proof, but it edits
  `AppDelegate`/`SessionServe` — bytes owned by an in-flight seat (#787 is
  rewriting the stager's neighbors) — and the socket-persistence +
  page-driven-/api proxies already separate a page-opened boot from a
  merely-serving one. If the proxies ever prove too loose, the host-side
  line is the first upgrade, not a rework.
- **Harvesting the port from the unified log too** (logging the origin URL
  with port from `maybeOpenOrigin`). Tempting one-line fix, but it edits the
  serving seat's log spelling — a cross-layer token surface
  (transport-tokens / doc/webserver-contract.md) other tooling may match on —
  and the socket table is already authoritative. The asymmetry with android
  (`port=` in the log) is documented in both scripts.
- **Launching the DEBUG harness with `-dsh-serve`** (the debug opt-in to the
  same serving path) instead of building Release. Loses: `-dsh-serve` still
  needs the official dist staged into the app container (debug's
  StageOfficialWeb is a no-op), so the pin would depend on runner-side
  staging the release build embeds for free — and the pin's whole point is
  the bytes a user actually runs (release, embedded dist, interactive
  config).
