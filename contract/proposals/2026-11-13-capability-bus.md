# Proposal: the capability bus — a self-describing descriptor plane over the frozen gateway (draft)

> **Status: DRAFT (D5 proposal — nothing frozen, nothing implemented; adoption
> folds a new primitive row and a descriptor grammar additively). No frozen
> shape changes, no permission or audit change, no host change proposed here.**
> English | [简体中文](2026-11-13-capability-bus.zh.md)

## Motivation

Adding ONE OS capability today touches seven places in lockstep — every one a
hand-maintained copy of a fact the tree already knows:

1. **The frozen table.** `contract/primitives.md` §2 carries the 33 rows
   through v1.11.0 (`primitives.md:153-253`); a new capability argues its row
   through §8's restraint rule (`primitives.md:701-718`). This place is the
   STABILITY contract and stays — the point of this proposal is that it is
   not the only place.
2. **The iOS serving list.** `GatewayCore.primitives` is a hand-pinned
   `static let` whose own comment admits it is a second copy of a truth:
   "the name list IS the RuntimeDescriptor's available array, so it must
   stay identical to what `registerStandardPrimitives` actually wires"
   (`hosts/ios/App/Source/Gateway/GatewayCore.swift:123-129`, the 37-name
   list at :130-143). An invariant held by comment discipline, not by
   construction — the descriptor pre-eval then copies the list again
   (`hosts/ios/App/Source/Gateway/GatewaySession.swift:351-359`).
3. **The Android serving list — times six.** `GatewayCore.PRIMITIVES` plus
   its `PHASED_ROWS`/`RETIRED_ROWS` satellites
   (`hosts/android/app/src/main/java/com/dshmobile/host/GatewayCore.kt:23-51`)
   are copied into a hand-built descriptor JSON by SIX session classes
   (`BindingHost.kt:52-57`, `SessionServe.kt:318`,
   `SessionPersistRestartSession.kt:55`, `SessionLiveSession.kt:51`,
   `SessionWriteSession.kt:50`, and the honest-empty web-session face
   `OfficialWebSession.kt:61`).
4. **The harmony serving list — twice, in two languages.**
   `HostPhase.ets` carries the descriptor as a hand-concatenated JSON string
   with a "Keep in sync with the C fallback in gateway_smoke.cpp" comment
   (`hosts/harmony/entry/src/main/ets/model/HostPhase.ets:136-154`), and
   `gateway_smoke.cpp` carries the twin with the mirrored instruction
   ("Keep in sync with HostPhase.ets's BINDING_DESCRIPTOR",
   `hosts/harmony/entry/src/main/cpp/gateway_smoke.cpp:70-94`). Keeping the
   twins honest costs a dedicated gate — `tools/check-descriptor-parity.mjs`
   (wired as the `descriptor-parity` gate, `gates.json:237-252`) statically
   re-derives four faces (the two descriptors, the C forward list, the
   ArkTS `onDispatch` rows, the C `smoke_known_absent` set) and its buffer
   check records the measured near-miss: the 28-row descriptor sat at
   **511/512 bytes** of `host_start`'s fixed buffer — "one added row from a
   dead phase start" (`tools/check-descriptor-parity.mjs:203-207`).
5. **The hand-pinned per-host census counts.** 25 E2E manifests pin the
   descriptor's numeric shape as literal match objects — the capability
   binding legs pin `36/3` on Android
   (`test/e2e/scenarios/android-capability-binding.json:20-25`) and `33/9`
   on harmony (`test/e2e/scenarios/harmony-capability-binding.json:34-38`);
   the iOS legs pin `37/2` (`gateway-binding.json:14-18`,
   `device-plane.json:14-18`) and `35/2` + `blePlane: 8`
   (`ios-ble.json:14-18`, `ios-ble-denied.json:14-18` — the denied seat
   serves two rows fewer); the harmony BLE family pins `30/9` + 8
   (`harmony-ble.json:14-18`); the smoke face pins `33/0` + 8
   (`camera-plane-capture.json:14-18`); the fs-collapse-era Android seat
   pins `34/3` (`android-ble-absent.json:14-18`). Every added row
   mechanically reddens every one of a host's manifests until each count is
   re-pinned by hand.
6. **The audit-invariant cell list.** The audit-COMPLETENESS leg enumerates
   59 probe cells by hand in the scenario script
   (`runtime/dsh/scenario/gateway-audit-invariant.js:99-283` — success,
   rejection, socket, and `unavailable` quadrants) and re-enumerates them as
   59 literal `audit.probe` expectations in the manifest
   (`test/e2e/scenarios/gateway-audit-invariant.json:10-69`, the `calls: 59`
   pin at :70, and the seat descriptor pin `13/9` at :9). A new row needs a
   new cell in BOTH — or the invariant silently stops covering it.
7. **The typed JS shim.** `runtime/dsh/gateway.js` exposes one export per
   primitive with its frozen shape ("every primitive of
   contract/primitives.d.ts is exposed with its frozen shape",
   `gateway.js:2-5`; `fsRead` at :61 through `micStop` at :381). This place
   is legitimate — a typed face over the frozen shapes — but a new row
   still adds its export here in the same change.

The R3 face batches measured what this lockstep costs: each host batch was
sized M for "renderer + legs" work that exists mostly because three hosts
must each re-declare shared facts by hand
(`contract/proposals/2026-11-12-native-face-schemas.md:279-283` (the three
host batches), :371-377 (the sizing line "M per host batch (renderer +
legs), L across the program")).

The proposal: **a self-describing descriptor plane over the frozen gateway**
— the Linux split between `/proc/devices` (what the running kernel actually
has) and the uAPI headers (what userspace may pin against). One vocabulary
becomes runtime TRUTH, derived from code that already exists; the other
stays the owner-gated stability contract. The seven places above collapse
into two writers: the registration site (once, in native code) and the
contract fold (once, by the owner).

## The design

### 1. Two vocabularies, on purpose

- **The RuntimeDescriptor becomes runtime TRUTH.** Today it is two flat
  arrays (`available`/`unavailable`) hand-built at each pre-eval site
  (`GatewaySession.swift:354-359`, `BindingHost.kt:52-57`,
  `HostPhase.ets:143-154`). The proposal makes each entry self-describing:
  a row carries its `name`, the `schemaVersion` of the frozen shape it
  speaks, its audit class (the §6 per-call record, the audited-never-settled
  control face such as `httpFetch.abort` — `GatewayCore.swift:306-310`, and
  the host-initiated record such as `socket.accept` —
  `gateway-audit-invariant.js:199`), and its permission flag (or none — the
  `deviceInfo` precedent below). Every field must be DERIVABLE from
  boot-time registration facts; none may be hand-authored prose. The
  descriptor is per-host by nature and is never edited — only built.
- **`primitives.md` stays the STABILITY contract.** Owner-gated, folded
  through §8, it remains what plugins PIN against: the shape a manifest's
  `capabilities.required` names, the error codes §3 freezes, the audit
  posture §6 mandates. The two vocabularies answer different questions —
  the descriptor answers "what does THIS host serve right now", the contract
  answers "what may I rely on across hosts and time". Plugins **negotiate
  against the descriptor; pin against the contract.** Neither absorbs the
  other's job.

### 2. Boot-time self-registration is already there — the descriptor just stops lying about it

Native handlers already register into a dispatch registry at boot: the iOS
core is "dispatch table name→handler"
(`GatewayCore.swift:117-122`) with `register(name:_:)` as the single
ingestion point (:183-185) and `registerStandardPrimitives` the one boot
call every full seat keeps identical to the hand list (:150-167); Android's
`register` is `GatewayCore.kt:152`. The ONLY thing that is not derived from
that registration is the descriptor — which is why each host carries a
comment ordering itself to stay identical to it (`GatewayCore.swift:124-126`,
`HostPhase.ets:141-142`, `gateway_smoke.cpp:81-82`). The change is exactly
one step: **build the descriptor from the registry as registration
completes**, and delete the hand lists. The harmony parity gate's four
faces collapse to one — the built descriptor IS the served face, so the
gate stops comparing copies and starts comparing the build against the
forward/dispatch reality (the check it already knows how to do,
`check-descriptor-parity.mjs:103-183`).

### 3. The `describe` primitive — the one new vocabulary row

One additive primitive exposes the enumeration at runtime: `describe`
(one name's row) and `describeAll` (the whole table). Metadata only — names,
versions, audit classes, permission flags; never payload contents, never
capabilities the caller does not already hold the flag grammar for. The
negotiation-class precedent is `deviceInfo`: the frozen table carries it
with NO permission flag (`primitives.md:205`, the `—` cell) and the iOS
handler serves read-only facts with no consent surface
(`hosts/ios/App/Source/Gateway/DevicePlanePrimitives.swift:5-6`, :18, :26-40)
— metadata about the device, not power over it. `describe` is the same
posture pointed at the gateway itself; its own call is audited like every
§6 call.

**Honest absence is the adoption path** (the law §7 #1 already wrote:
"declares an absent primitive `unavailable` honestly in its
`RuntimeDescriptor` — absence is information for negotiation, never faked",
`primitives.md:683-685`): a host that has not adopted `describe` answers it
`unavailable`, and a caller that sees `unavailable` falls back to the
frozen table as the enumeration vocabulary — negotiation, not a branch.

**Version collision, dispositioned up front.** The next additive minor is
contested ground: `contract/proposals/2026-11-11-gateway-primitive-slimming.md`
claims v1.12.0 and records the monotonic-fold-ordering rule against
`net-fd-wrap`'s live candidacy (:167-180; the candidate title at
`contract/proposals/2026-10-19-net-fd-wrap.md:1`, its own next-free rule at
:270-276; the convention itself is the v1.9.0 note,
`primitives.md:76-79`). This proposal claims NO number now: **it takes the
next free number at ITS adoption under the same rule** — v1.14.0 if the
current disposition holds (slimming v1.12.0, net-fd-wrap v1.13.0),
renumbered per monotonic fold ordering if the runway order differs.

### 4. Derived census — manifests stop pinning numbers

The 25 manifests' `descriptor.declared` pins become checker-verified
STRUCTURAL invariants instead of literal counts: the checker reads the
descriptor the runtime actually declared (the same `__dshGatewayDescriptor`
read the audit leg already does, `gateway-audit-invariant.js:267-272`) and
asserts the properties that matter — audit pairing completeness (below),
available/unavailable disjointness, no phantom rows (a name in the
descriptor that no served face answers), plane sizes only where a scenario
is genuinely about a plane (the BLE legs' `blePlane: 8`). The philosophy is
the one `doc/e2e-matrix.md` already recorded when it stopped hand-maintaining
its tables: "the three tables below are regenerated from
`node test/e2e/matrix.mjs --out` (the machine inventory), closing the
doc-drift class this page had accrued" (`doc/e2e-matrix.md:9-11`;
`test/e2e/matrix.mjs:3-6`). A pinned count is a receipt of the tree that
produced it, not a contract; regenerating beats re-pinning.

### 5. Structural audit pairing — the invariant generalizes

`gateway.audit-invariant`'s own design is already a pairing walk, not a
shape check: "The ledger is the call half of the pairing; the host's audit
stream … is the record half. … fails naming any call whose paired record is
missing, any record with no call, any order violation, and any payload
bytes inside a record" (`gateway-audit-invariant.js:10-16`, the ledger at
:50-61). The proposal generalizes the INPUT: instead of the hand-enumerated
59 cells, the checker derives the cell set from the descriptor — **every
registered handler must have a paired audit record** — and the leg keeps
its three-state matrix (ok / a §3 rejection / honest `unavailable`) as the
per-row coverage standard it already enforces. New rows then join the
invariant by EXISTING, not by being added to two lists.

## The boundary (non-negotiable)

- **The bus IS the privileged layer.** The descriptor plane is served by
  the same host-fixed gateway the contract froze — "host-fixed, never a
  plugin. It is the only door between the JS runtime and the platform"
  (`primitives.md:140-141`, the architecture diagram row at
  `doc/ARCHITECTURE.md:33`). It is never a system plugin and never
  marketplace-installable: the marketplace's ed25519 catalog signature is
  the trust root of the PLUGIN plane ("The signature is the trust",
  `data-protocols.md:163`) — moving descriptor authority behind it would
  put the OS boundary inside the distribution plane. The posture is the
  Linux lockdown one: the device table ships in the signed kernel image;
  signed modules only under enforcement. Drivers here = handlers compiled
  into the store-signed host binary, full stop.
- **Every frozen shape stays byte-for-byte (D5).** The 33 §2 rows, the §3
  error codes, the §5 channels, the §6 audit record — untouched. `describe`
  joins as a new row; the descriptor grammar folds as a new section of the
  contract docs; nothing existing moves.
- **Security-bearing validation stays at the gateway** — permission-flag
  checks before dispatch and the §6 audit records (the slimming round's
  boundary rule, `2026-11-11-gateway-primitive-slimming.md:184-188`;
  §6's "Audit is mandatory and host-fixed", `primitives.md:675-677`).
  `describe` carries no validation away; it reports what the validator
  already enforces.
- **The two consent layers are unchanged** — gateway grant first, OS
  permission second, neither substitutes for the other
  (`2026-09-30-system-capability-plane.md:49-55`). A descriptor row names
  the flag; it grants nothing.

## Non-goals

- **No frozen-shape edits** (D5): no row rewrite, no result change, no
  error-code change; the fold is additive only.
- **No runtime-downloadable drivers**: no dynamic handler loading, no
  descriptor-authored capabilities, no plugin-provided rows — the
  registration site is native code in the store-signed binary.
- **No permission or audit weakening**: nothing moves out of §6; the
  audit-invariant leg gets STRONGER (derived coverage), never looser.
- **No `hostType` branching** (RFC 0002): which rows a host serves is
  capability negotiation data in the descriptor — the per-host service
  truth the slimming round already classified as negotiation, never a
  platform conditional (`doc/ARCHITECTURE.md:158`,
  `primitives.md:134-136`).
- **No cordis-plane extension**: the bus is not a plugin API; §Alternatives
  records why the plugin plane cannot host it.

## Alternatives considered

- **Extend the vendored cordis to be the bus** — rejected: the trust root
  cannot live in the plugin plane. System plugins ARE cordis plugins — the
  runtime boots the vendored `@deepseek-ai/cordis` Context
  (`runtime/dsh/upstream/boot.js:27`, the pin at
  `runtime/dsh/vendor/npm/cordis@4.0.2`) and every provider face is a
  cordis service over the gateway (`runtime/dsh/system-plugins/dsh-fs/cordis.js:2`).
  A descriptor plane that plugins could extend would let the enumerated
  surface grow underneath the contract's restraint rule, and D6 forbids
  editing the vendored package to try. The gateway is the trust boundary
  precisely because nothing below it is loadable.
- **One vocabulary — let the descriptor REPLACE the frozen table** —
  rejected: the freeze is what plugins pin against; §8's restraint rule
  ("Restraint is the point of a narrow table", `primitives.md:717-718`) and
  the §7 conformance definition are contract-document properties, not
  runtime properties. A runtime-derived table cannot freeze a shape for the
  life of major version 1 — that is not what a running system can promise.
  Two vocabularies with honest derivation beat one vocabulary pretending to
  be both.
- **Status quo (keep the seven-place lockstep)** — rejected: the cost is
  measured, not hypothetical. The harmony twins need a dedicated parity
  gate whose buffer check caught a one-row-from-brick near-miss
  (`check-descriptor-parity.mjs:203-207`); the R3 face batches were
  M-per-host largely because three hosts re-declare shared facts by hand
  (`2026-11-12-native-face-schemas.md:371-377`); and every capability
  addition reddens 25 manifests plus two audit lists until hands re-pin
  them (§ Motivation 5-6).

## Evidence

All citations read fresh in this seat at the docs/capability-bus-draft cut
(`d3375af4`):

- The frozen contract: `contract/primitives.md` — the v1.11.0 title (:1),
  the freeze posture (:3-4), the monotonic-fold convention (:76-79), the
  negotiation/no-branching frame (:131-136), §1 "host-fixed, never a
  plugin" (:138-141), §2's 33 rows (:153-253) with the `deviceInfo` no-flag
  row (:205), §6 audit (:669-677), §7 conformance with the honest-absence
  law (:679-697, #1 at :683-685), §8 versioning and restraint (:701-718).
- The hand-maintained serving lists and their sync orders:
  `hosts/ios/App/Source/Gateway/GatewayCore.swift:117-185` (class doc,
  the identity-demand comment :123-129, the 37-name list :130-143,
  `phasedRows` :144-147, `registerStandardPrimitives` :150-167,
  `register` :183-185) and the abort control face :306-310;
  `hosts/android/app/src/main/java/com/dshmobile/host/GatewayCore.kt:23-51`
  (PRIMITIVES/PHASED_ROWS/RETIRED_ROWS) and `register` :152; the six
  Android descriptor pre-eval sites (`BindingHost.kt:52-57`,
  `SessionServe.kt:318`, `SessionPersistRestartSession.kt:55`,
  `SessionLiveSession.kt:51`, `SessionWriteSession.kt:50`,
  `OfficialWebSession.kt:61`); the iOS pre-eval
  (`GatewaySession.swift:351-359`); the harmony twins
  (`HostPhase.ets:136-154`, `gateway_smoke.cpp:70-94`).
- The parity gate that exists only because the lists are hand copies:
  `tools/check-descriptor-parity.mjs:4-19` (the four faces and the §7 #1
  rule it enforces), :89-93 (the descriptor-diff detector), :103-183
  (forward/dispatch/known-absent cross-checks), :203-207 (the 511/512
  fixed-buffer finding), wired as the `descriptor-parity` gate
  (`gates.json:237-252`).
- The census pins: 25 manifests under `test/e2e/scenarios/` carry a
  `descriptor.declared` literal-count match — the count verified by grep
  over the directory; named examples with their pins:
  `android-capability-binding.json:20-25` (36/3),
  `harmony-capability-binding.json:34-38` (33/9),
  `gateway-binding.json:14-18` (37/2), `device-plane.json:14-18` (37/2),
  `ios-ble.json:14-18` (35/2 + blePlane 8),
  `ios-ble-denied.json:14-18` (33/2 + 8), `harmony-ble.json:14-18`
  (30/9 + 8), `camera-plane-capture.json:14-18` (33/0 + 8),
  `android-ble-absent.json:14-18` (34/3 + 8).
- The audit-invariant pairing design and its hand-enumerated cells:
  `runtime/dsh/scenario/gateway-audit-invariant.js:2-16` (the pairing
  contract), :50-61 (the ledger), :99-283 (the 59 cells across four
  quadrants), :267-272 (the runtime descriptor read);
  `test/e2e/scenarios/gateway-audit-invariant.json:9` (the 13/9 descriptor
  pin), :10-69 (the 59 literal probe rows), :70 (`calls: 59`).
- The typed shim: `runtime/dsh/gateway.js:2-5` (the one-export-per-primitive
  header claim), representative exports `fsRead` :61, `httpFetch` :176,
  `deviceInfo` :228, the camera trio :297-315, the BLE family :317-349,
  `micStart`/`micStop` :366-381.
- The regenerate-don't-hand-maintain precedent:
  `doc/e2e-matrix.md:9-11`, `test/e2e/matrix.mjs:3-6`.
- The version-collision record this proposal dispositions into:
  `2026-11-11-gateway-primitive-slimming.md:167-180` (the rule and the
  v1.12.0 claim), `2026-10-19-net-fd-wrap.md:1` and :270-276 (the
  candidacy and its next-free rule), `primitives.md:76-79` (the convention).
- The boundary anchors: `primitives.md:138-141` and `doc/ARCHITECTURE.md:33`
  (host-fixed, never a plugin), `data-protocols.md:163` (the marketplace
  signature is the trust), `2026-09-30-system-capability-plane.md:49-55`
  (the two consent layers), `doc/ARCHITECTURE.md:158` and
  `primitives.md:134-136` (the RFC 0002 anti-pattern ban), the slimming
  round's security-stays-at-the-gateway rule
  (`2026-11-11-gateway-primitive-slimming.md:184-188`), and the plugin
  plane's cordis identity (`runtime/dsh/upstream/boot.js:27`,
  `runtime/dsh/vendor/npm/cordis@4.0.2`,
  `runtime/dsh/system-plugins/dsh-fs/cordis.js:2`).
- The lockstep cost precedent: the three R3 host batches and their sizing
  (`2026-11-12-native-face-schemas.md:279-283`, :371-377).

## Sizing

S for the proposal fold itself: the `describe`/`describeAll` row + the
descriptor-grammar section in the contract docs + the contract README
pointer, one PR. The implementation rides machinery that exists — boot-time
registration (`GatewayCore.swift:150-167`, `GatewayCore.kt:152`), the
pre-existing pairing walk (`gateway-audit-invariant.js:10-16`), and the
parity gate's detector set (`check-descriptor-parity.mjs:103-183`) — so the
migrations are: descriptor build at registration (M across three hosts,
each mostly deleting a hand list), the describe handler (S per host, one
shared shape), the manifest census flip (S — checker mode + re-pin removal),
the audit-invariant derivation (M — the checker grows the descriptor-driven
cell set). Nothing here changes a frozen shape, a permission check, or an
audit record.
