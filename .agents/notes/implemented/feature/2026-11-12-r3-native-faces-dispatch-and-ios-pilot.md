# R3 of the native declarative-faces program — the render-intent dispatch layer and the iOS face.*@1 pilot

Status: implemented

Date: 2026-11-12 · Class: feature · Seat: feat/r3-native-faces (plan.md §14 R3; task T-0290)

## Problem

The R3 census (2026-11-12, four sweeps — iOS, Android, harmony, producers)
found the native render-intent plane versioned nowhere, with live defects
riding the drift (the proposal's Motivation,
`contract/proposals/2026-11-12-native-face-schemas.md:9-69`):

1. The `card.*` bus lines and `question.*` frames were held by five
   independent renderers through code symmetry alone — no schema, no version.
   The iOS 取消 button had no handler so the parked ask waited forever
   (`hosts/ios/App/Source/SessionQuestions.swift:55` before this change), a
   `card.present` missing its id was silently dropped by every host, and the
   mount gate's approval `message` key was read by NO host (the detail line
   never rendered anywhere).
2. #764 converged the producer side (`presentationMeta` +
   `presentCall`/`presentResult`, pinned by `test/panel/tool-card-face.test.js`)
   but nothing consumed it natively.

The proposal (DRAFT pair under `contract/proposals/`, bilingual with its
`.i18n.yaml`; the contract README indexes it) declares the `face.*@1` family;
this change lands the two implementation halves the program named: the
platform-neutral dispatch layer and the iOS pilot batch.

## Decision

### The dispatch layer (runtime/dsh/render-intent.js + face-schemas.js)

One seam every native render payload crosses: face type → `schemaVersion` →
validation → bus row. The validation core is pure
(`face-schemas.js` — `FACE_VERSION`, closed `kind` set, `{id,label}` option
normalization, `detail` canonical with no `message` alias blessed, picker's
served `mode` set including `media`); the crossing layer
(`render-intent.js:220` `mountRenderIntent`) owns the post, exactly one
structured `face.degrade` warn per ladder rung (never crash, never silent),
and the D8 action inbox: hosts deliver `card.action`/`question.answer` frames
as events (`onAction`/`awaitAction` with a producer-side deadline), the
`close` action is terminal per card id, a throwing handler degrades instead
of taking the sequence down. `toolViewFace` maps the #764 vendored vocabulary
(referenced, never redefined — D6) onto `face.card@1`; the frozen primitive
RESULTS never pass through the layer (the irreducible boundary, proposal §6).

### The producer merge

- `question-bridge.js` parks asks through `faces.presentQuestion` (options
  normalized, `schemaVersion` declared) and `__dshQuestionAnswer` gained the
  `outcome` parameter: a `cancelled` frame settles the parked ask — the
  park-forever defect dies at the bridge.
- `plugin-mount.js` builds the approval request via `approvalPayload`
  (`detail`, not the unread `message`), forwards the frozen
  `{approved, remember?}` call unchanged, and reports `faceDetail` on the
  `approved` step so the create-card leg can pin the fix.
- `dsh-create/index.js` rewrote authoring contract item 5 + the template to
  the `renderIntent()` API (`presentCard`/`cardState`/`cardComplete`,
  declarative `actions`, the `card.action` close subscription, legacy raw bus
  rows still valid).
- The web client answers questions by option id, never echoed label
  (`presentation/web-client-v2/web/js/render-chat.js`, answer-by-id).
- Pinned by `test/panel/render-intent.test.js` (the ladder, the inbox, the
  tool-view presenter, the payload validators).

### The iOS pilot (batch 1) + scenario legs + mirrors

`CardPlayerSurface.swift` became a generic face.card@1 renderer
(`schemaVersion` read, `actions:[{id,label}]` as buttons, one
`GatewayCore.uiMarker("card-degrade", …)` per ladder rung, user acts posted
back as `card.action` over the question.answer delivery path);
`SessionQuestions.swift` parses canonical options and its 取消 now delivers
`question.answer {outcome:"cancelled"}`; `QuestionFaceDrive.swift` is the new
`-dsh-mode question-face` leg; `BundleStager.swift` stages the layer
(`stageFaceLayer`). The legs: `runtime/dsh/scenario/question-face.js` (a REAL
`ctx.userQuestions.ask()` on the vendored waterfall, cancelled through the
native dialog — no LLM dialed), the card-player leg extended with a
declarative action and the `card.action` round-trip, and the create-card leg
pins `approval.answered {detail:true}` (evidence under
`hosts/ios/artifacts/{question-face,card-player,create-card}/`, judged
E2E-by-logs per D7). The staged mirrors (android assets, harmony rawfile +
BUNDLE_FILES, iOS RESOURCES via `gen_bundle_resources.py`) and the
staging-generator rows landed in the same change; `closures`,
`bundle-files`, `staging-check`, `staging-generated` green.

**Deferred, honestly**: Android and harmony native faces are proposal
batches 2/3 (not wired here — the one card-player scenario serves every seat
by tolerating the absent action event); the native appshell/A2UI renderer
and the settings-row face stay named deferrals (proposal §7).

## Alternatives considered

- **Per-host validation where the payload lands (status quo)** — rejected:
  the census IS that cost — five renderers, three ladders, one unread key;
  a shared pure core is what makes the ladder enforceable and testable.
- **An umbrella `face.present` envelope** — rejected in the proposal §"one
  umbrella": the channels genuinely differ (bus lines vs primitive
  payloads); the layer dispatches onto the channels that already exist
  instead of re-routing them (zero new primitives, zero new event channels).
- **Consuming #764's presenter vocabulary natively in this batch** —
  rejected as scope: `toolViewFace` provides the mapping and the panel pin,
  but native presenter surfaces belong to the deferred batches, so the
  pilot's blast radius stays the card + question faces.
- **Hand-editing the staged mirrors** — never; canonical edited,
  `build/build.sh sync` / staging generators re-emitted, byte-verified by the
  closures gate.
