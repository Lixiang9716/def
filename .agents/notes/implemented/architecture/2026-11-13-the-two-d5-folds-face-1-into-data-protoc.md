# Agent Note: the two D5 folds — face.*@1 into data-protocols v1.4.0 §11, the slimming round into primitives v1.12.0

Status: implemented
Related: D5

## Problem

Two adopted-pending D5 proposals sat as DRAFTs while reality had already moved
past the frozen documents in both directions. The native declarative faces
(card/question bus faces, the approval/picker/notify request payloads) were
rendered by five independent implementations with no schema, no version, and
measurable drift in both directions — a detail key no host read
(`plugin-mount.js` passing `message`), an ask that parked forever on cancel,
and a picker `mode` the prose did not declare. Symmetrically, the primitive
table was thinner than reality (the capability plane — camera, eight BLE rows,
mic — served by all three hosts but named by no row) and fatter (rows with no
engine or no implementation — `ishRun` since the 2026-10 retirement,
`channelOpen`/`channelClose` with zero implementations anywhere). Negotiation
reads the descriptor, not the truth: a table wrong in either direction is the
same dishonesty. Both rationale records existed
(`contract/proposals/2026-11-12-native-face-schemas.md`,
`contract/proposals/2026-11-11-gateway-primitive-slimming.md`) and the owner
had authorized folding the full fleet queue, but the frozen documents still
described the previous world.

## Decision

The owner-authorized fold lands both proposals as additive contract
revisions, docs only — zero runtime/host/test edits (the code already serves
these shapes; the docs catch up):

- `contract/data-protocols.md` + `.zh.md` → **v1.4.0**: new §11 "Native face
  payloads (`face.*@1`)" freezing the five face families (card/question
  bus faces with the `card.action` host→runtime return and the
  `outcome:"answered"|"cancelled"` rule — absent = answered; approval/picker/
  notify request payloads, results untouched byte-for-byte), the versioning
  rule (`schemaVersion` optional integer, absent = legacy forever; removal/
  retype/required-addition forbidden within a family), the action-return
  contract, the degradation ladder, and the fail-soft-vs-fail-loud boundary.
- `contract/primitives.md` + `.zh.md` → **v1.12.0**: §2 gains the Tier A
  family-classification table (nine families, why irreducible + 2026-11-11
  in-service hosts), eleven capability-plane rows (#34–44: `cameraCapture`,
  the eight BLE rows, `micStart`/`micStop`, shapes per the adopted
  2026-09-30 record), and the Tier B deprecation markings (`ishRun` #16 and
  `channelOpen`/`channelClose` #27-28 — deprecated now, removal at v2.0.0
  with migration paths; `socketListen`/`socketConnect` stay Tier A with the
  vacancy annotated). 33 + 11 = 44 primitives. §8's deferred list drops the
  three delivered families and records the deprecation posture.
- `contract/primitives.d.ts` stays in lockstep: header brought current (it
  was stale at v1.5.0 despite body content through v1.11.0), v1.12.0 types
  copied from the adopted proposal verbatim, `@deprecated` JSDoc on
  `ishRun`/`channelOpen`/`channelClose`.
- Proposal status flips: face-schemas and slimming DRAFT → ADOPTED (rationale
  records, bodies kept per the render-surface precedent); the 2026-09-30
  capability-plane status line corrected at adoption (its "nothing
  implemented" claim was stale; the camera-frames half re-shaped to a
  dedicated seat, never `channelOpen("camera")`); net-fd-wrap's candidacy
  renumbered v1.12.0 → v1.13.0 (monotonic fold ordering).
- `contract/README.md` + `.zh.md` rows and the adopted-folds list updated
  (the A2UI → v1.3.0 §10 entry the row was missing is recorded too).
- The two producer-side one-liners the face-schemas sizing named needed no
  work: they already landed in #765/#766 (verified in-seat: `plugin-mount.js`
  passes canonical `detail` via `approvalPayload`; `question-bridge.js`
  settles `outcome:"cancelled"`) — noted in the face-schemas status flip
  instead.

## Alternatives considered

- **Fold the faces into `a2ui.messages@0.9`** (the proposal's own rejected
  alternative) — A2UI is the session-content tier for WebView/Lynx
  renderers; the native faces are OS-surface-bound payloads that must render
  when no WebView is live. Two declared tiers beat one stretched format.
- **Defer the capability-plane fold to a separate later round** — rejected by
  the slimming record itself: the slimming round is exactly when the table is
  re-audited against reality; splitting it would leave the "nothing
  implemented" status line stale through another fold cycle.
- **Fold §5 channel rows (`mic.frame`, `ble.event`) alongside the eleven §2
  rows** — deliberately NOT done: the brief scopes this fold to the §2 rows
  and the Tier A/B annotations; the delivery channels stay in the adopted
  proposal record, which §2's table intro names as the carrier of the full
  shapes. A §5 row lands with the render-intent dispatch work that first
  mints a consuming leg, so §5 records channels the frozen text can point at
  end-to-end.
- **Leave net-fd-wrap's title at v1.12.0 until its own adoption** — the
  slimming record's §3 said the retitle is its owner's one-line change at
  renumber time; the owner's blanket fleet instruction authorized this round
  to apply the disposition now, and leaving the title would contradict the
  slimming record's own recorded disposition.

## Consequences

The contract is honest in both directions: every face payload is versioned
and degrades by a declared ladder instead of drifting by symmetry; the
primitive table names every row the hosts serve and marks every row nothing
serves. New work negotiates against v1.4.0 §11 and v1.12.0 §2 — plugins pin
these shapes from this landing forward. The ishRun/channel mechanical tail
(probe, wrapper export, manifest row, audit cells) rides the v2.0.0 removal
change, costing the deprecation window nothing.
