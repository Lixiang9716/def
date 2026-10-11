# Agent Note: the iOS create-card E2E leg rides the real spine seat — one `sh`-invocable runner with a narrating gateway seat and a global simulator lock

Status: implemented

## Problem

The `create.card` chain had no iOS evidence leg: no runner in `test/e2e/`
launched DSHHost with `-dsh-mode create-card`, and the branch's runtime
chain could not have satisfied its own manifest anyway — three independent
breaks, any one of which reds the checker forever:

1. The branch's scenario probed the PRE-cordis success string
   (`已安装并激活`) while the plugin's live-mount rewrite answers
   `已作为真实 cordis 插件在线插入`, and the bare module-import seat never
   runs dsh-create's `apply()`, so the plugin's module-global spine stays
   null and the mount refuses ("no cordis spine on this seat") —
   `approval.answered`/`registry.installed` were unreachable.
2. The manifest (10 rows, behind mainline's 12) pinned
   `card.face.presented`/`completed`, whose only producer anywhere was
   android's `BindingHost.kt` — no iOS host emitted them, and the branch
   manifest also omitted `client.selected`/`create.card.spine.booted` that
   the real spine seat emits.
3. The runner's event-anchored screenshots would have grepped
   never-produced event strings and silently captured nothing.

Plus two runner-level hazards found in review: `select_sim` needs python3
but the check lived in the build branch (`--skip-build` skipped it, and a
missing python3 misreported as a simctl failure), and the global mkdir lock
had no staleness probe — a SIGKILLed holder would burn every later run's
full 45-minute deadline.

## Decision

Four moving parts, each mirroring an existing pattern rather than inventing
one:

1. **`test/e2e/run-ios-create-card.sh`** — sibling of
   run-ios-mic-plane.sh's machinery (perl-alarm `simctl launch` with
   `--stdout` capture, prefix-free terminal-marker grep, `check.mjs`
   one-to-one checker, shared `write-receipt.sh`) with a GLOBAL simulator
   lock (`/tmp/dsh-ios-e2e-sim.lock`: owner marker with pid, pid-liveness
   probe steals a dead holder's lock loudly, EXIT trap releases, 45-min
   acquire deadline at a 15 s poll), simulator discovery
   (`--udid` > `$DSH_E2E_UDID` > booted iPhone > available iPhone we boot,
   `sim-preflight.sh` gating every selection), upfront python3/node
   discovery (the workflow caller cannot export env), `sh`-invocable POSIX
   body self-rooted from `$0`, and a build segment that materializes the
   untracked trees first (vendor ensure ×2 → `gen.sh` → `xcodebuild`
   Debug). Evidence lands in `hosts/ios/artifacts/create-card/`; matrix
   registration is deliberately not the runner's job (no CLI, no
   precedent).
2. **The runtime chain synced to the mainline spine-seat shape**
   (`runtime/dsh/scenario/create-card.js`,
   `runtime/dsh/system-plugins/dsh-create/index.js`,
   `runtime/dsh/plugin-mount.js` + the 12-row manifest) — the exact
   non-android deltas of mainline fc14f0f1, where `bootUpstream` gives the
   mount a real cordis context, `plugin-mount`'s `opts.onStep` seam lets
   dsh-create narrate `approval.answered`/`registry.installed` under
   `create.card`, and the success predicate accepts both vocabulary
   spellings.
3. **The iOS gateway seat narrates like android's**
   (`GatewaySession.SeatAnnounce`, opt-in): the create-card drive announces
   `client.selected` before the scenario's first record and narrates
   `card.face.presented`/`completed` on the bus thread at
   `busPosted` — on the bus thread deliberately: the record must precede
   the mount's continuation (`tool.returned`), and the main-thread surface
   hop cannot be trusted to win that race. Every other GatewaySession
   consumer (m2, mic, ble, camera) keeps a byte-shaped stream (nil
   default). `CardPlayerSurface` stays pure UI.
4. **The spine closure staged for the first iOS spine boot**
   (`BundleStager`): the boot.js graph resolves `upstream/*.js` singles from
   hand-written staging rows, and five of them had no rows —
   `llm-gateway-mount.js` (the live first failure),
   `llm-piai-mount.js`, `boot-demand.js`, `boot-compaction.js`,
   `boot-session-persistence.js` (all top-level imports; their bytes were
   already embedded by the generator — only the stager rows were missing).
   Everything else the boot graph needs already rides whole-dir tree rows
   (`upstream/shims`, the system-plugins dirs, the vendor pins) or existing
   rows — verified by walking boot.js's transitive repo-relative imports
   against the staged set, not by another round of whack-a-mole.
5. **Proof, on the simulator**: the leg ran green end-to-end on iPhone 17
   Pro Max (iOS 26.5) — `rt: create-card drive finished verdict=PASS`,
   `e2e: PASS create.card (12/12 events, in order)`, receipt written, both
   event-anchored screenshots captured — and the pre-push evidence gate
   (`sh test/e2e/matrix.sh --accept-known-gaps`) passes with the new dir
   counted (101 dirs, 213 verdicts, 217 pngs, 0 unregistered findings).
   The synthetic cross-check stands too: the android green run's records
   score 12/12 against the synced manifest, and dropping
   `client.selected` fails loudly (11/12).

## Alternatives considered

- **Hardcoded default UDID (the sibling convention)**: rejected — the ask
  requires discovery; preflight still catches bad runtimes.
- **Per-UDID `$HOME` pidfile lock only (the sibling convention)**:
  rejected — it does not serialize different legs (lock name embeds the
  runner name) nor stale holders; the global mkdir lock matches the
  resource, and the pid probe reuses the siblings' `kill -0` idiom for the
  staleness half.
- **Reshaping the manifest to what unmodified iOS could produce** (drop
  `client.selected`/`spine.booted`/`card.face.*` rows): rejected — the
  manifest is the scenario's cross-host contract (T-0212 names the
  12-event shape the android #453 and harmony #455 siblings closed with);
  forking it per host is the RFC 0002 anti-pattern at the evidence layer.
- **Emitting the face events from the scenario JS**: rejected — android's
  BindingHost would then double-emit (its native narration plus the JS
  copy), breaking android's one-to-one match; and gating by host in JS is
  hostType branching.
- **Narrating from `CardPlayerSurface.handle`**: rejected — the surface
  runs on the main thread and the presented record must land before
  `tool.returned` (the mount returns while the hop is still queued);
  android narrates on the bus thread for exactly this reason.
- **WDA/idb UI automation of the approval alert**: rejected — the
  `-dsh-script-approval` seam genuinely presents the alert and settles it
  0.35 s in; the `approval.answered` record is the observable.
- **The android leg's inline receipt heredoc**: rejected — the shared
  `write-receipt.sh` is the iOS family's current convention.

## Consequences

The branch's runtime JS now matches mainline for the create-card chain, so
the eventual merge back carries no contract divergence. Any second
simulator consumer that does not take the global lock can still race this
leg; converging the `run-ios-*` family on it is the natural follow-up.
The green evidence (`hosts/ios/artifacts/create-card/`) is untracked in
this worktree — landing it follows the usual branch → PR → gates flow
(T-0212 items 4-5), not this note.
