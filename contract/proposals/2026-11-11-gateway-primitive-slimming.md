# Proposal: gateway primitive slimming — annotate the irreducible native ABI, deprecate the vacant ceremony rows (v1.12.0 annotation round)

> **Status: ADOPTED (2026-11-13, owner authorization: folded additively as
> primitives.md v1.12.0 — the rationale record; §1's Tier A annotations,
> §2's deprecation markings, and §3's capability-plane fold all landed —
> 33 + 11 = 44 primitives — and the 2026-09-30 capability-plane status line
> was corrected at adoption per this file's own recommendation).**
> English | [简体中文](2026-11-11-gateway-primitive-slimming.zh.md)

## Motivation

The seam-collapse program (plan.md §13) has finished its first two phases: P1
swapped the product fs seat to the dsh-fs cordis provider over the gateway
primitives (#762; `runtime/dsh/upstream/boot.js:198-211` — `mountFileTools`
mounts OUR `DshFsProvider` as the `ctx.fs` service, the vendored fs-local is
retired from the product boot), and P2 audited `ctx.shell`/`ctx.subprocess`
to dualPlane:false with honest vacant-seat dispositions
(`.agents/notes/implemented/architecture/2026-11-12-p2-shell-subprocess-seam-audit.md`).
The provider is now the only product face of a capability; the gateway table
underneath is what a provider may demand of a host.

That makes the frozen table's own honesty the remaining debt, and it has
drifted in BOTH directions:

1. **Rows whose engine or implementation no longer exists.** `ishRun` (v1.3.0,
   primitives.md §4 "emulated userland") has had **no in-service host since the
   2026-10 retirement** — the contract's own status note records it
   (primitives.md:123-129), iOS keeps the row named only so the honest
   `unavailable` answer stays wired (`hosts/ios/App/Source/Gateway/GatewayCore.swift:127-141`),
   Android carries it in `RETIRED_ROWS` for the same reason
   (`hosts/android/app/src/main/java/com/dshmobile/host/GatewayCore.kt:46-51`),
   and harmony declares it unavailable
   (`hosts/harmony/entry/src/main/ets/model/HostPhase.ets:154`). The channel
   seam (v1.9.0, `channelOpen`/`channelClose`) has **zero implementations
   anywhere** — a repo-wide grep over `*.c/*.swift/*.kt/*.ets/*.cpp` finds no
   occurrence of `channelOpen` outside this proposal. The socket seam
   (v1.8.0) exists in the shared C spine (`src/dsh_socket.c:146-246`, wired by
   `src/dsh_runtime_host.c:3891-3893`) but **no product host descriptor names
   either row** (absent from the iOS, Android, and harmony lists cited above).

2. **Rows the table does not carry but every host implements.** The system
   capability plane — `cameraCapture`, the eight BLE rows, `micStart`/
   `micStop` — is served by all three hosts (iOS
   `GatewayCore.swift:138-141`, Android `GatewayCore.kt:35-38`, harmony
   `HostPhase.ets:149-151`) while the carrying proposal still reads
   "**Status: DRAFT (D5 proposal — nothing frozen, nothing implemented)**"
   (`contract/proposals/2026-09-30-system-capability-plane.md:3`). The frozen
   table (primitives.md §2, 33 rows through v1.11.0) names none of them. A
   table that is thinner than reality is the same dishonesty as one that is
   fatter: negotiation reads the descriptor, not the truth.

3. **Ceremony layers above the table that carry no security.** The seam
   collapse moved capability faces into providers, but some non-security
   ceremony still lives in duplicated copies that no gate pins together: the
   gateway-address derivation exists three times with identical math
   (recorded by the P2 audit as deferred hygiene — shell `toGateway`
   `runtime/dsh/system-plugins/dsh-shell-js/applets-support.js:115-125`,
   `DshFsProvider.address`
   `runtime/dsh/system-plugins/dsh-fs/cordis.js:104-115`, office
   `scopePathFor` `runtime/dsh/system-plugins/dsh-office/fschannel.js:22-33`),
   and the fs-seam gate's refusal text still names the retired `mountWorkspace`
   (`runtime/dsh/upstream/shims/fs-seam-gate.js:33`).

This proposal is the P3 contract-slimming half of the program: **shrink the
honest negotiating surface to the irreducible native ABI, mark what is
ceremony and sink it into providers, and give the vacant rows an explicit
deprecation posture instead of an eternal frozen silence.** D5 stands
untouched: every frozen shape stays byte-for-byte; slimming is expressed as
annotation, deprecation, and redirection of new consumers — never as an edit
to a frozen shape.

## The design

### 1. Tier A — annotate the irreducible native ABI (all additive doc truth)

One word of classification per family in §2 of the frozen table, stating WHY
the row is irreducible (the only provider of the capability is the OS or the
host process itself) and which hosts serve it today:

| Family | Rows (§2 #) | Irreducible because | In-service hosts (2026-11-11) |
| --- | --- | --- | --- |
| fs core | `fsRead`/`fsWrite`/`fsScope` #1-3, `fsStat`/`fsList`/`fsMkdir`/`fsRemove`/`fsRename` #10-14, `fsPublishAtomic`/`fsSync` #32-33 | the host's file world is reachable no other way (D2: no subprocess; D6: vendored code never touches the disk) | iOS, Android, harmony (harmony serves the core trio + durable pair; the metadata five answer `unavailable` — `HostPhase.ets:152-154`) |
| network | `httpFetch` #4 | the host network stack is the only egress | all three |
| consent surfaces | `notify` #5, `presentApproval` #6, `presentPicker` #7 | a user-facing OS surface is itself the trust boundary | all three |
| credentials | `keychainGet`/`keychainSet` #8-9 | OS credential stores | all three |
| execution | `wasmRun` #15 | an in-process interpreter is host machinery by definition (the iOS JIT ban leaves no alternative) | iOS, Android (harmony: `unavailable`) |
| timer | `timerSchedule`/`timerCancel` #17-18 | a future callback must re-enter the serial queue through the host (D2/D8; the v1.4.0 fold's evidence: 22 suite failures without it) | all three |
| device plane | `deviceInfo`/`haptic`/`clipboardRead`/`clipboardWrite`/`presentShare`/`keepAwake` #19-24 | platform SDK access, several behind OS permission prompts | all three |
| render surface | `presentSurface`/`surfaceDraw`/`closeSurface` #29-31 | a host-native window is OS machinery | harmony only (iOS/Android keep the Web Client creation viewer as the negotiation floor) |
| socket | `socketListen`/`socketConnect` #25-26 | OS sockets; **and the audit record is the control** — sinking them below the gateway would delete the security boundary (five-rule model, primitives.md §4 "the socket seam") | the shared C spine / CLI host; **no product host stages them** |

Tier A rows keep their frozen shapes verbatim; new providers and new
consumers keep negotiating exactly as today. The annotation is doc truth
about *why the row exists*, versioned as a v1.12.0 doc revision (no shape
change, no negotiation change).

### 2. Tier B — deprecate the vacant ceremony rows, redirect new consumers

- **`ishRun` (#16) — deprecate now, remove at v2.0.0.** No in-service host
  since 2026-10 (evidence above); its audit-honesty hole (§4: the gateway
  "cannot audit what the program does inside the guest") makes the row a
  grant ceremony around an engine that no longer exists. Migration path for
  any future consumer that needs program execution:
  1. **the upstream `ctx.subprocess` cordis seat** — author
     `system-plugins/dsh-subprocess-<face>/cordis.js` extending the vendored
     `SubprocessRuntime` (the seat-connection path the P2 audit recorded);
  2. **`wasmRun`** where an in-process interpreter suffices (the wasm shell
     precedent).
  No capability consumer exists today — the mechanical tail that remains
  (the web-live boot's availability probe, the wrapper export, the dead
  manifest capability row, and the audit-invariant leg's `unavailable` cells)
  is enumerated in §5 and rides the removal change, so the deprecation window
  costs nothing: mark deprecated at v1.12.0, carry the marking through the
  v1.x line, remove the row in the v2.0.0 document with a migration note (§8
  already reserves exactly this mechanism).
- **`channelOpen`/`channelClose` (#27-28) — same posture decision, owner's
  call.** Zero implementations, zero capability consumers, and the v1.9.0
  fold's source table (`motion`, `battery`) has no served host. Either the
  first consumer proves the seam (a host implements it) or the rows join
  `ishRun` in the v2.0.0 removal set. This proposal recommends the
  deprecation marking now, with the same window as `ishRun`, so the frozen
  table stops implying a served surface that nothing serves — and §3
  dispositions the one design that still names `channelOpen` as its carrier
  (the capability plane's camera-frames half) so the marking leaves no
  dangling consumer.
- **`socketListen`/`socketConnect` (#25-26) — keep (Tier A), annotate the
  vacancy.** Unlike the channel rows these carry a real audit boundary and a
  real implementation (the C spine; the parity/suite legs exercise it).
  The annotation records: served by the CLI spine today, staged by no
  product host — absence is information for negotiation, never faked (§7 #1).

### 3. Fold the rows reality already serves (the anti-drift half)

The v1.12.0 doc revision this proposal asks for ALSO folds the capability
plane into §2 — eleven rows (`cameraCapture`, eight BLE, `micStart`,
`micStop`) every host already serves — adopting
`contract/proposals/2026-09-30-system-capability-plane.md` whose status line
must be corrected at adoption (its "nothing implemented" claim is stale
against the three host lists cited in the Motivation). Slimming without this
fold would be dishonest: the table must shrink toward the truth in both
directions.

**The adopted proposal's channel half is dispositioned here, not silently
dropped.** The 2026-09-30 proposal routes its continuous camera-frames
stream over the channel seam — "`channelOpen` gains a `"camera"` **source**
in its closed, versioned source table" (`2026-09-30-system-capability-plane.md:117-119`,
the permission table's `channelOpen("camera")` row at :248) — the very pair
Tier B above recommends deprecating. This proposal records which design
wins: **the dedicated-seat precedent the deployed world already chose.** The
implemented microphone and BLE faces rejected `channelOpen`-only carriage
for control (the proposal's own Alternatives, :314-318 — `channelOpen`'s
`{ hz, tag }` opts cannot carry an audio format, a scan filter, or a GATT
tuple), and the shipped delivery rides dedicated event seats, not
`channel.event`: harmony's mic emits `mic.frame` bridge events directly
(`hosts/harmony/entry/src/main/ets/model/MicPrimitives.ets:312`, consumed at
`runtime/dsh/gateway.js:357,394-395`). At adoption, the camera-frames half
is therefore re-shaped to the same pattern — a dedicated
`cameraFramesOpen`/`cameraFramesClose` control pair (or the capture
primitive's own `camera.frame` seat) over the seam's delivery *rules*
(latest-wins, no-delivery-while-suspended), never the `channelOpen`
subscription face — and the two phased `cameraRecordStart`/`Stop` rows keep
their shapes as the proposal specifies them (control calls, not channel
sources), implemented when their phase lands. With that re-shape, no design
in force names `channelOpen` as its carrier and the Tier B deprecation
stands. If the owner instead funds the channel seam's first host, the
camera-frames half may keep its `channelOpen("camera")` shape — but then
§2's channel bullet flips to the Tier A vacancy annotation and this §3
re-shape is void; the two decisions are one decision.

**Version-number collision, dispositioned (the repo's explicit-note
precedent).** The v1.12.0 candidacy this round claims is not free:
`contract/proposals/2026-10-19-net-fd-wrap.md:1` is a live DRAFT titled
"(v1.12.0 candidate)" and argues "v1.12.0 is the next free additive number"
(:276) — and the adopted producer-registry proposal carried the same
candidate title without taking a number. The convention the repo already
records (primitives.md:76-79, the v1.9.0 fold note; net-fd-wrap's own
"the fold renumbers per the next-free rule at adoption", :276) resolves it:
**monotonic fold ordering wins.** This annotation round is on the runway
now, so it takes v1.12.0 if it folds first; net-fd-wrap's candidacy moves to
v1.13.0 (its own next-free rule, applied at its adoption), and no proposal
title below that renames until a fold actually lands. Recording the
collision here is the fix; editing the other DRAFT's title is its owner's
one-line change at renumber time.

### 4. The boundary rule: what sinks into a provider, what never does

- **Security-bearing validation STAYS at the gateway.** The scope-escape
  rejection ("a path that escapes its scope root is rejected as `invalid`
  **before** any host call", primitives.md §4 "filesystem additions"
  :302-303) is authorization, not ceremony. So are permission-flag checks
  and the §6 audit records. No part of this proposal moves them.
- **Data-shaping ceremony SINKS into providers.** The concrete sinks this
  program already surfaced (P2's deferred hygiene, sized for the follow-up):
  1. the gateway-address derivation exists three times — dedupe into one
     shared provider-side rule so a future edit to one copy cannot reopen
     the two-address-space bug P1 closed;
  2. the stale `fs-local`/`mountWorkspace` wording in the shim gate
     (`fs-seam-gate.js:33`) and the web-write files the P2 audit named —
     ceremony text, provider-space repair;
  3. the posture asymmetry (ungranted scopeRoot: shell refuses loudly,
     `cordis.address` silently degrades) — provider-space alignment.
  New consumers of a capability reach for the **upstream seam**
  (`ctx.fs`, `ctx.subprocess`, the tools registries) and never for a second
  gateway face — the collapse discipline P1/P2 established.

### 5. Consumer migration paths and deprecation windows

| Row | Consumer today | Migration path | Window |
| --- | --- | --- | --- |
| `ishRun` | no capability consumer (engine retired 2026-10); a mechanical tail only — the web-live boot's availability probe (`runtime/dsh/web-live/composer-web-live.js:433` `probeIshRun()`), the wrapper export (`runtime/dsh/gateway.js:129-130`), the dead `ishRun` entry in `runtime/dsh/manifest.json` `capabilities.required`, and the audit-invariant leg's `unavailable` cell (`runtime/dsh/scenario/gateway-audit-invariant.js:232`) | `ctx.subprocess` cordis seat (P2's path) or `wasmRun`; the tail rides the removal change: the probe's expected answer flips to `denied`, so the probe asserts the removal or is deleted, the wrapper export and the manifest capability row go, and the audit cell updates — one PR, no compat carry | marked deprecated v1.12.0; removed v2.0.0 with the tail edits above |
| `channelOpen`/`channelClose` | no capability consumer; the same audit-invariant leg probes both rows' `unavailable` answers (`runtime/dsh/scenario/gateway-audit-invariant.js:243-244`, pinned by `test/e2e/scenarios/gateway-audit-invariant.json:64-65`) — and §3 re-shapes the one design that named `channelOpen` as carrier | a host implementation proves the seam (then §2 flips to the Tier A annotation and §3's re-shape is void), or removal rides v2.0.0 carrying the audit-cell updates | same marking as `ishRun` |
| `socketListen`/`socketConnect` | the CLI spine / parity-suite legs | none needed — rows stay Tier A with the vacancy annotated | n/a |
| address-derivation copies (not a row) | shell, dsh-fs, dsh-office | one shared provider rule; each copy's host imports it | lands as the P2-recorded P3-sized follow-up, before any new consumer joins |

## Non-goals

- **Any edit to a frozen shape** (D5): annotations, deprecations, and the
  capability-plane fold are the only touches; §8's major-version mechanism
  owns the actual removals.
- **New primitives beyond the fold**: the table's restraint rule
  (primitives.md §8) stands; anything else argues its necessity the usual way.
- **Host branching**: every classification above is per-host SERVICE truth in
  the RuntimeDescriptor, which is capability negotiation, never a
  `hostType` conditional (RFC 0002).
- **Moving permission checks or audit out of the gateway** — the §4 boundary
  rule names them immovable.

## Alternatives considered

- **Keep the table silent about vacancy (status quo)** — rejected: the
  channel seam proves the failure mode; three years of "frozen" is not the
  same as three years of "served", and negotiation cannot tell them apart.
- **Deprecate the socket rows with the channel rows** — rejected: they carry
  a real implementation, a real audit boundary, and real (suite-leg)
  consumers; the honest annotation is vacancy, not death.
- **Fold the capability plane in a separate later round** — rejected as
  sequencing: the slimming round is exactly when the table is re-audited
  against reality; splitting it would leave the "nothing implemented" status
  line stale through another fold cycle.
- **Hand-correct the 2026-09-30 proposal's status line from here** —
  rejected: its status changes when IT is adopted (the producer-registry
  precedent — the adopting PR updates the proposal it adopts); this file
  only cites the drift.

## Evidence

- The frozen table and its drift, both directions: `contract/primitives.md`
  (§2 rows #1-33 at :153-253; the ishRun status note :123-129; §4 semantics;
  §8 evolution :701-718; the monotonic-fold numbering note :76-79).
- Host service truth (read 2026-11-11 in the feat/seam-collapse-p2p3 seat):
  `hosts/ios/App/Source/Gateway/GatewayCore.swift:127-141` (full list incl.
  wasmRun :130, camera/BLE/mic :138-141; no socket/channel/surface rows),
  `hosts/android/app/src/main/java/com/dshmobile/host/GatewayCore.kt:30-51`
  (same, camera/BLE/mic :35-38, + RETIRED_ROWS :46-51),
  `hosts/harmony/entry/src/main/ets/model/HostPhase.ets:143-154`
  (BINDING_DESCRIPTOR: surface trio + capability plane available :147-151;
  the unavailable block — phased camera-record rows, fs metadata five,
  wasmRun, ishRun — :152-154).
- The channel seam's absence: repo-wide `grep channelOpen` over
  `*.c/*.swift/*.kt/*.ets/*.cpp` returns nothing (run 2026-11-11).
- The channel seam's one designed consumer and its re-shape basis: the
  capability plane's camera-frames half riding `channelOpen("camera")`
  (`2026-09-30-system-capability-plane.md:117-119`, :248), the mic/BLE
  dedicated-control rejection of channel-only carriage (:314-318), and the
  SHIPPED dedicated-seat delivery (harmony `mic.frame` bridge events,
  `MicPrimitives.ets:312`, consumed at `runtime/dsh/gateway.js:357,394-395`).
- The v1.12.0 collision: `contract/proposals/2026-10-19-net-fd-wrap.md:1`
  ("v1.12.0 candidate") and :276 (the next-free rule at adoption);
  `contract/proposals/2026-10-24-producer-registry.md:1` (the same candidate
  title, adopted without taking a number).
- The ishRun/channel mechanical tail: `runtime/dsh/web-live/composer-web-live.js:433`
  (`probeIshRun()`), `runtime/dsh/gateway.js:129-130` (the wrapper export),
  `runtime/dsh/manifest.json` (`capabilities.required` still lists `ishRun`),
  `runtime/dsh/scenario/gateway-audit-invariant.js:232,243-244` with
  `test/e2e/scenarios/gateway-audit-invariant.json:64-65` (the
  `unavailable`-answer cells the removal PR updates).
- The socket seam's spine implementation: `src/dsh_socket.c:146-246`,
  `src/dsh_runtime_host.c:3891-3893`, `example/main_cli.c`.
- The provider-seat mechanism this proposal builds on (#762):
  `runtime/dsh/upstream/boot.js:198-211` (mountFileTools mounts
  `DshFsProvider` as the `ctx.fs` service),
  `runtime/dsh/system-plugins/dsh-fs/cordis.js:1-30` (the cordis provider
  over the gateway primitives), and the P2 audit's vacant-seat discipline
  (`.agents/notes/implemented/architecture/2026-11-12-p2-shell-subprocess-seam-audit.md`).
- The ceremony sinks: `applets-support.js:115-125`, `cordis.js:104-115`,
  `fschannel.js:22-33` (three derivation copies), `fs-seam-gate.js:33`
  (stale wording) — all recorded by the P2 audit's deferred-hygiene section.

## Sizing

S (documentation round): the §2 annotations + two deprecation markings + the
capability-plane fold (carrying §3's channel-half re-shape and the version
disposition) + the 2026-09-30 status correction + the `contract/README.md`
current-DRAFT pointer refresh (it names forkpty and the capability plane
today, `contract/README.md:20`; landing this third DRAFT and the later fold
each touch that line) — one PR, no host code. The provider-space ceremony
sinks (§4) are the separately-sized follow-up the P2 audit already recorded.
The code half of P3 (the tool-card contract upgrades over the pinned
`defineTool` face) lands in the same seat as this proposal and is recorded
in its own Agent Note.
