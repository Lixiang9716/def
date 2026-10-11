# The session-persistence seat wiring — the gate row, the configured-session page resume, and the three restart legs

Status: implemented
Related: T-0212 (this work's task card), the backend leg this wiring rides
(`implemented/feature/2026-10-11-session-persistence-jsonl-resume.md` — the
vendored JSONL backend the gate row now feeds), D8 (the legs report as
structured log events, one expected-↔-logged match per pin)

## Problem

The vendored session-persistence backend shipped gated and default-off
(boot-session-persistence.js), proven only by the CLI leg (two dsh-cli
processes over one container). Nothing fed the gate on any device host: the
user-facing interactive seats never carried a `sessionPersistence` row, the
v2 client cold-started into an empty home even when the container held a
restorable journal, and no device leg proved the resume chain
(create → force kill → relaunch → read back → continue) on the hosts' own fs
shims. T-0212's checklist names exactly these three gaps.

## Decision

- One choke point forwards the flag: `web-live/boot-options.js` maps
  `cfg.sessionPersistence === true` to the gate's config object `{}` —
  DEFAULTS, deliberately (root omitted → `<profileCwd>/dsh/sessions` inside
  the pinned container, the fs shims' write-through mirror twin; compression
  omitted → the vendored default `zstd`). Absent flag → the key stays off
  the options object entirely, so every ungated boot (parity/golden/
  manifests) is byte-identical; `boot.js` already threaded
  `identity.sessionPersistence` and `boot-session-persistence.js` already
  gated on it, so the runtime half needed zero changes. The
  boot-carrier vitest pins both directions (absent → `toBeUndefined()` +
  `in` check; present → `toEqual({})`).
- The three user-facing interactive seats feed the flag — iOS
  SessionServe.runtimeConfig, Android SessionServe.runtimeConfig, Harmony
  OfficialServe.interactiveConfig, each inside the existing `interactive`
  block next to commands/goals/fileReferences. Drive seats construct their
  seats with interactive=false, so their cfg carries no key.
- The page resumes on cold start: `main.js` waits for the mux-open AND the
  BYOK panel's boot decision (onboarding.js now stamps `panel.dataset.
  settled` on every detect exit), then auto-opens the first non-blank
  session by `updatedAt` (skipping blank boot-seeded shells); an empty list
  keeps the existing create path. Scope honesty: the list is the live
  store, and boot re-seeds only the CONFIGURED session — so the auto-open
  engages when that session carries journal (exactly the restart legs'
  shape); page-created conversations are not re-attached after a restart
  until the list-merge/re-attach seam lands. The open rides the ONE openSession
  channel, so the journal replays through the snapshot opening frame and the
  regular timeline fold — no resume-specific rendering.
- The restart legs are a shared self-staging runtime half
  (`web-live/session-persist-restart-core.js` + one thin entry per host):
  the CLI scenario's `sessionPersistence: {}` row drives the gate directly,
  the leg reads the boot state to pick its stage (fresh → create leg;
  restored seed → resume leg), and the runner owns the process boundary
  (force kill + relaunch, same container). Pins: the restored journal tail
  sits at the persisted boundary (the vendored `session/end-seed` seed
  marker — `turn/end` pre-seed), session/list carries the old session
  through the REAL read surface, turn 2 continues the journal,
  `turnBoundary.lastTurn == 2` —
  the CLI leg's cross-process ground truth (seed 12 events, turn 2 appends
  9). Host machinery: an Android `SessionPersistRestartSession` (+`--ez
  dsh.persistrestart`), a Harmony `session-persist.restart` E2E leg via
  OfficialServe's new entry/label override, an iOS `-dsh-mode
  session-restart` drive via the existing scenarioEntry override; embed
  lists updated (stage-spine-closure both loops, harmony CLOSURE +
  BUNDLE_FILES, iOS gen_bundle_resources row); runners under
  hosts/android/ci, hosts/harmony/ci, test/e2e (the iOS runner takes BOTH
  the new cross-runner `/tmp/dsh-ios-e2e-sim.lock` mkdir lock and the
  existing per-UDID pid lock).

## Alternatives considered

- Seat-side per-host persistence rows with a custom root per host — beat by
  the shared `{}`: the boot default already lands inside each host's granted
  scope, and a custom root would invent a second durability story to prove.
- Making the restart legs page-driven (auto-open + a typed second prompt) —
  beat by the runtime-driven leg: the pins are persistence semantics, the
  page drive would add UI-automation flakiness to all three hosts, and the
  session/list pin is stronger through the real `makeListSessions` handler
  the page would hit. The page half is covered by the auto-open change
  itself and the existing v2web drives.
- Merging `ctx.get('sessionPersistence').list()` snapshots into
  `makeListSessions` so page-created sessions survive into the sidebar —
  deferred: without a re-attach path those rows are not page-addressable
  (session/follow would fail), so listing them today would trade a silent
  gap for a broken tap. The restart legs use the configured session, which
  the boot re-seeds into the store, so the pin holds honestly.

## Consequences

Kill/relaunch is now a first-class leg on every host; `pm clear`,
`bm clean`, and `simctl uninstall` between the legs erase the journal under
test, so the runners confine them to setup — and the Harmony runner uses
`hdc uninstall` as its ONE setup wipe, because `bm clean -d` proved NOT to
clear the app sandbox on this emulator (measured 2026-10-11: a post-clean
launch resumed a 12-event journal). Two more measured transport facts the
runners encode: the Harmony C host opens its capture file FRESH per launch
(the runner lifts each launch's capture and merges them into one stream),
and the restored journal tail is the vendored `session/end-seed` marker on
every host. The evidence drives stay byte-identical (the vitest
undefined-pin is the regression tripwire); the code-size gate holds (the
restart core is split into ≤50-line functions, the seat files stay ≤500).
