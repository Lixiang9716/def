# Proposal: native declarative faces — the versioned payload schema family above the irreducible primitives (`face.*@1` fold candidate)

> **Status: ADOPTED (2026-11-13, owner authorization: folded additively as
> data-protocols.md v1.4.0 §11 — the rationale record; the two producer-side
> one-liners the sizing named already landed in #765/#766 — `plugin-mount.js`
> now passes the canonical `detail` via `approvalPayload`, and
> `question-bridge.js` settles `outcome: "cancelled"`). No primitive row, no
> frozen shape, no result changes.**
> English | [简体中文](2026-11-12-native-face-schemas.zh.md)

## Motivation

The R3 census (2026-11-12; four sweeps — iOS, Android, harmony hosts, and the
producer side) found the native render-intent plane in three distinct drift
states, and every one of them is unversioned payload drift above or beside
frozen contracts:

1. **Bus faces whose only contract is code symmetry.** The `card.*` bus lines
   and the `question.*` frames are rendered by five independent
   implementations (three native hosts plus the runtime bridge and the web
   client's card face — `presentation/web-client-v2/web/js/card-face.js:1-8`
   states "the same contract verbatim") with no schema, no version, and one
   prose paragraph inside `PLUGIN_CREATE_DESCRIPTION`
   (`runtime/dsh/system-plugins/dsh-create/index.js:110-115`) as the whole
   documentation. Live defects ride the drift: the iOS cancel button has no
   handler so no `question.answer` is ever delivered
   (`hosts/ios/App/Source/SessionQuestions.swift:55`) and the Android twin
   dismisses without answering either
   (`hosts/android/app/src/main/java/com/dshmobile/host/QuestionDialog.kt:114`)
   — the parked ask then waits forever by design
   (`runtime/dsh/web-live/question-bridge.js:10-12`, "Without a page answer
   the ask stays parked"); a `card.present` missing its id is silently
   dropped by every host with nothing logged
   (`hosts/ios/App/Source/CardPlayerSurface.swift:76-77`,
   `hosts/android/.../CardSurface.kt:95-96`,
   `hosts/harmony/.../CardFace.ets:50-53`).

2. **Payload faces above frozen primitives — one prose sentence each.** The
   results of `presentApproval`/`presentPicker`/`notify` are frozen
   (contract/primitives.md §4), but the request payloads are undocumented
   prose, and the drift is measurable in both directions:
   - `runtime/dsh/plugin-mount.js:144-147` passes `{title, message}` while
     iOS reads `{title, detail, allowRemember}`
     (`hosts/ios/App/Source/Gateway/UIPrimitives.swift:39-41`), Android reads
     the same three (`hosts/android/.../UiPrimitives.kt:56-58`), and harmony
     reads `{title}` only (`hosts/harmony/.../OfficialServe.ets:1246-1258`)
     — so the mount gate's detail line never renders on ANY host today: the
     `message` key is read by no one.
   - The frozen picker prose says `mode: "file" | "directory"`
     (primitives.md §4) while all three hosts serve `"media"` too
     (`UIPrimitives.swift:124-129`, `UiPrimitives.kt:44,137-145`,
     `PickerPrimitives.ets:47-50,154-157`).
   - `notify` title is required-and-`invalid` on iOS and Android
     (`NotifyPrimitive.swift:28-31`, `NotifyPrimitive.kt:46-47`) but silently
     defaults to `'DSH'` on harmony (`HostPhase.ets:888`).
   - The approval ladder exists as three hand-rolled copies per host family:
     `presentApproval` itself, the clipboard-read consent
     (`ClipboardPrimitives.swift:33-65`, `ClipboardPrimitives.kt:48-69`), and
     the BLE consent layer (`BLEPrimitives.swift:96-117` fully hard-coded on
     iOS; `BleConsent.kt:60-94` hard-coded and **dormant** on Android —
     `capabilityPrompter` is assigned only in the iOS tree), sharing no
     declared payload.

3. **Converged render-intent with zero native consumers.** #764 landed the
   producer side — `presentationMeta` + `presentCall`/`presentResult` across
   five plugin families against the vendored
   `@deepseek-ai/dsh-tools@0.1.6-alpha.2` vocabulary
   (`runtime/dsh/vendor/dsh/tools@0.1.6-alpha.2/lib/types/presentation.d.ts`),
   pinned by `test/panel/tool-card-face.test.js` — but no shipped consumer
   runs the presenters, and the appshell/A2UI face has no native renderer on
   any host (iOS: zero matches for the three names across
   `hosts/ios/App/Source`; harmony: zero ArkTS consumption of
   `app-shell/0.9`).

The proposal: **give the native faces what `surface.ops@1` and
`a2ui.messages@0.9` already have** — a versioned, additive, field-declared
schema family in data-protocols.md, an event-sequence action-return contract
(D8), and a degradation ladder that never crashes and never drops silently —
while leaving the gateway primitives underneath irreducible and byte-for-byte
frozen.

## The design

### 1. The face vocabulary (census-converged)

The ask's candidate list (card / question / approval-present / picker-present
/ surface / settings-row) converges against census reality to five frozen
candidates, three referenced-not-redefined formats, and two honest deferrals:

| Face / format | Channel | Consumers today (census) | Disposition |
| --- | --- | --- | --- |
| `face.card@1` | bus lines `card.present/state/complete/dismiss` | iOS `CardPlayerSurface.swift`, Android `CardSurface.kt`, harmony `CardFace.ets`, web `card-face.js` | **in v1** |
| `face.question@1` | bus frames `question.request/answer/decided` | iOS `SessionQuestions.swift`, Android `QuestionDialog.kt`, the web page card (harmony answers through the WebView — no native face) | **in v1** |
| `face.approval@1` | request payload above `presentApproval` + the consent twins (clipboardRead, the BLE prompt layer) | three hand-rolled ladders (evidence above) | **in v1** (request side only; results frozen) |
| `face.picker@1` | request payload above `presentPicker` | all three hosts (`mode` validated per host) | **in v1** (request side only) |
| `face.notify@1` | request payload above `notify` | all three hosts | **in v1** (request side only) |
| `surface.ops@1` | `presentSurface`/`surfaceDraw` | harmony canvas trio | **referenced** — already frozen (data-protocols.md §9); this proposal adds nothing to it |
| `a2ui.messages@0.9` + `app-shell/0.9` | session content over SessionServe | web client / Lynx renderers | **referenced** — already frozen (data-protocols.md §10); a NATIVE renderer is the deferred item below |
| the vendored tool-card vocabulary (`presentation.d.ts`, `presentCall`/`presentResult`/`presentationMeta`) | journal tool records | producers converged (#764); no consumer | **referenced** — native consumption is the render-intent dispatch obligation (§7), not a new schema |
| settings-row | none | **no native settings face exists on any host**: iOS is a file relay + CSS injection (`SessionServe.swift:298-317`, `CarrierBootConfig.swift:93-125`), Android is one CSS row (`CarrierIndexRows.kt:37-49`) with "revocation = deleting the app until a settings face exists" (`BleConsent.kt:15`), harmony is a headless file handshake (`LlmConfigStaging.ets:5-34`) | **deferred, named** — the natural future face (grant revocation reading the standing-grant stores); inventing it now would freeze a face reality does not serve |
| boot overlay / harness consoles | host chrome | iOS boot strings, debug-only consoles | **out** — not product faces (the iOS console is never built on release; the harmony verdict panel is harness chrome) |

### 2. The field schemas (every field carries its census evidence)

Naming rule: each family is `face.<name>@<major>`; the payload carries an
integer `schemaVersion` naming the family version the producer speaks.
Fields marked **v1-add** are the only new fields; everything else is today's
shape, now declared.

#### face.card@1 — the PiP card bus face

| Frame | Field | Type / default | Evidence |
| --- | --- | --- | --- |
| `card.present` | `card.id` | string, **required** — missing id is refused (not rendered) and warned, never silently dropped | the producer contract says REQUIRED + "a missing id is silently dropped by every host" (`dsh-create/index.js:110-111`); iOS `CardPlayerSurface.swift:76-77`, Android `CardSurface.kt:95-96`, harmony `CardFace.ets:50-53` |
| | `card.title?` | string, defaults to id | iOS `:81`, Android `:102`, harmony `CardFace.ets:120` |
| | `card.subtitle?` | string; rendered by iOS/Android, ignored by harmony | documented producer-side (`dsh-create/index.js:111-112`); iOS `:82`, Android `:103` |
| | `card.kind?` | **closed set** `{info, timer}` (default `info`); unknown kind degrades to `info` WITH a logged warn — today the open string falls through to non-timer styling silently | iOS `:83`, Android `:104`, harmony `:121,123`; producer: 'only "timer" gets the countdown face; default "info"' (`dsh-create/index.js:111`) |
| | `card.durationMs?` | number — the local countdown anchor | iOS `:79`, Android `:98`, harmony `:55` |
| | `card.label?` | string — the non-timer text line | iOS `:93-95` (state), harmony `CardFace.ets:126-129` |
| | `card.actions?` | **v1-add**: `[{id, label}]` — declarative action buttons; a host without button support ignores the array with a logged warn (the card still renders) | the census gap on all three hosts: the card has zero interactive elements beyond local close (Android `CardSurface.kt:204-210` ✕ only; harmony census "zero interactive elements beyond local ✕") |
| `card.state` | `state.remainingMs?` | number — re-anchors the local clock | iOS `:89-92`, Android `:113-117`, harmony `:62-66` |
| | `state.label?` | string — swaps the text line | iOS `:93-95`, Android `:118-119`, harmony `:67-70` |
| | *(tween contract)* | hosts tick locally at 250 ms; 1 Hz patches suffice — pinned producer-side | `dsh-create/index.js:113` ("hosts tween locally at 250ms, so 1Hz patches suffice — never spam"); iOS timer at `CardPlayerSurface.swift:141-143` |
| `card.complete` | `message?` | string, defaults `"完成"`; iOS/Android auto-dismiss ~2.5 s, harmony keeps the card | iOS `:102,105-107`, Android `:127,130`, harmony `:75`; producer `dsh-create/index.js:114` |
| `card.dismiss` | `{}` | accepted by every host; no in-tree JS producer emits it | iOS `:70`, Android `:72`, harmony (census); producer census: "card.dismiss accepted by hosts, no JS producer in-tree" |
| `card.action` | **v1-add** (host→runtime): `{id, action: "close" \| "drag-end" \| "button", actionId?, at}` | the action-return event (§4) | rides the delivery path `question.answer` already uses (iOS `SessionServe.swift:461-462` `deliverRuntime`; Android `QuestionDialog.kt:156` `deliverRuntime`) |

#### face.question@1 — the in-band ask face

| Frame | Field | Type / default | Evidence |
| --- | --- | --- | --- |
| `question.request` | `id` | string, required (the askId) | `question-bridge.js:29-32` mints `question-<seq>-<ts>`; iOS `SessionQuestions.swift:19`, Android `QuestionDialog.kt:153` |
| | `questions[].id?` | string, defaults `q<n>` | iOS `:27`, Android `QuestionDialog.kt` (census) |
| | `questions[].header?` | string — the dialog title, default `"def"` | iOS `:29`, Android `:136` |
| | `questions[].question?` | string — the message body | iOS `:30`, Android `:137` |
| | `questions[].options[]` | **v1-add normalization**: `{id, label}` objects are canonical; a bare string remains accepted as `{id: <string>, label: <string>}`; answers identify options by **id**, never by echoed display label | today options are bare strings OR arbitrary objects and Android takes the LONGEST string value as the label (`QuestionDialog.kt:50-69`, "the key VARIES by model whim"); iOS reads only `option.label` (`SessionQuestions.swift:48`) and answers `[label]` (`:50`) — a relabeled option breaks the round-trip |
| `question.answer` | `outcome` | **v1-add**: `"answered" \| "cancelled"` — absent = `answered` (legacy frames unchanged); a cancelled ask settles the parked turn | the defect: iOS 取消 has no handler (`SessionQuestions.swift:55`) and Android 取消 dismisses without answering (`QuestionDialog.kt:114`), so the ask parks forever (`question-bridge.js:10-12`) |
| | `answers[].id` | string — the question id | iOS `:39,50`, Android `:156` |
| | `answers[].selected` | `string[]` — option **ids** under v1 (labels in legacy frames) | iOS `:39,50`; the bridge resolves `{answers}` verbatim (`question-bridge.js:21-27`) |
| | `answers[].custom?` | string — free-text answer | iOS `:40-42` |
| `question.decided` | `{id}` | unchanged — follows the settle | `question-bridge.js:35` |

#### face.approval@1 — the consent-ladder request face

Request side ONLY; the frozen result `{approved, remember?}` stays
byte-for-byte (primitives.md §4). The payload is exactly the three fields
hosts already read, now declared family-wide — plus `schemaVersion`:

| Field | Type | Evidence |
| --- | --- | --- |
| `title` | string (hosts default `""`/`"Approval"`) | iOS `UIPrimitives.swift:39`, Android `UiPrimitives.kt:56`, harmony `OfficialServe.ets:1247-1252` |
| `detail?` | string — the canonical detail field; **no `message` alias is blessed** (fail-loud, rule 5) | iOS `:40`, Android `:57`; the live drift: `plugin-mount.js:146` passes `message` and no host reads it |
| `allowRemember?` | boolean — present-remember UI when true | iOS `:41`, Android `:58`; harmony ignores it today (parses `{title}` only, `OfficialServe.ets:1249-1252`) — the family declaration makes the harmony parser widening a migration item |
| *(consent twins)* | clipboardRead consent reads the same `{title?, detail?}` over host-default copy today; the BLE prompt layer adopts the same shape so installing the dormant Android prompter is a payload read, not a fourth hand-rolled dialog | iOS `ClipboardPrimitives.swift:48-52`, Android `ClipboardPrimitives.kt:50-55`; BLE hard-coded: iOS `BLEPrimitives.swift:99-103`, Android `BleConsent.kt:78-81`; the dormant seam: `capabilityPrompter` assigned only at `BLEPrimitives.swift:50` (repo-wide grep, census) |

v1 declines (no consumer asking yet; the restraint rule applies to payload
faces too): structured risk objects, decline-reason/comment channels, i18n
button labels, host-side expiry. Each is an additive v2 candidate with its
census gap recorded.

#### face.picker@1 — the OS-picker request face

| Field | Type | Evidence |
| --- | --- | --- |
| `mode` | `{file, directory, media}` (iOS/Android default `file`) | iOS `UIPrimitives.swift:124-129`, Android `UiPrimitives.kt:44,137-145`, harmony `PickerPrimitives.ets:47-50,154-157` — note the frozen §4 prose still says `"file" \| "directory"`; the fold records the served set (doc truth, no shape change — the slimming round's anti-drift rule) |
| `suggestedName?` | string — served by harmony today, declared family-wide (additive elsewhere: unknown fields are ignored) | `PickerPrimitives.ets:47-50` |
| *(result)* | `{scope, path} \| null` frozen verbatim; user dismissal stays a null value | `UIPrimitives.swift:174-178,200` (census), `UiPrimitives.kt:203-204,233-234` (census) |

v1 declines: content filters and multi-select — both change the frozen
result shape (major-version material; iOS media is pinned to images,
selectionLimit 1, census).

#### face.notify@1 — the local-notification request face

| Field | Type | Evidence |
| --- | --- | --- |
| `title` | string, **required** — harmony's silent `'DSH'` default aligns to the `invalid` refusal iOS/Android already give | iOS `NotifyPrimitive.swift:28-31`, Android `NotifyPrimitive.kt:46-47`, harmony `HostPhase.ets:888` |
| `body?` | string | iOS `:50`, Android (census `:77`), harmony `HostPhase.ets:1146` |
| `threadId?` | string — iOS-served today, declared family-wide (additive) | iOS `NotifyPrimitive.swift:51` |
| `data?` | `map<string, any>` — iOS-served today (userInfo), declared family-wide (additive) | iOS `:52` |
| *(result)* | `{id}` frozen verbatim | iOS `:65`, Android `NotifyPrimitive.kt:63,88` (census), harmony `HostPhase.ets:1151` |

v1 declines: notification action categories (no host registers any — the
iOS census: the event's action field can only ever be the default tap).

### 3. Versioning — additive from day one

- `schemaVersion` is an optional integer on every face payload: top-level on
  bus frames (`{type:"card.present", schemaVersion:1, card:{…}}`), inside
  the request object on primitive payloads (`presentApproval({schemaVersion:1,
  title, detail})`). **Absent = legacy = today's exact behavior** — the
  tolerance is already producer-documented ("unknown fields are ignored
  everywhere, nothing throws", `dsh-create/index.js:115`), so a payload
  without the field renders identically on every host, forever.
- Additions mint the next integer (`face.card@2`) with a migration note —
  data-protocols.md §6 discipline. Because every addition is optional and
  the core shape never moves, a host may render a NEWER payload by ignoring
  unknown fields + one warn; a removal, retype, or required-field addition
  is forbidden within a family — it mints a new family name with a major
  fold and a migration note (§6's loud boundary).
- **Degradation is fail-soft for faces, fail-loud for install documents.**
  data-protocols.md §6 makes manifests/receipts/catalogs reject unknown
  majors loudly; render payloads are the opposite pole and stay fail-soft —
  the exact discipline the #764 convergence pinned ("presenters degrade to
  undefined, never throw"). A face is user-visible chrome, never
  authorization material; the §5 ladder defines the honest degrade.
- The family folds at adoption as **data-protocols.md §11 "Native face
  payloads (v1.4.0 — `face.*@1`)"**. v1.4.0 is that doc's next free
  additive number (it sits at v1.3.0; no DRAFT claims v1.4.0 — the v1.4.0
  strings in proposals/ refer to the old primitives timer fold). Monotonic
  fold ordering governs if another candidate lands first (the collision rule
  the 2026-11-11 slimming round recorded).

### 4. The action-return contract (D8 — event sequences, never polling)

User actions return to the runtime as events over channels that already
exist. No new gateway primitive, no new event channel, no shared host state:

1. **`card.action`** rides the host→runtime bus delivery that
   `question.answer` already uses (iOS `SessionServe.swift:461-462`;
   Android `QuestionDialog.kt:156`). Order guarantee: at most one terminal
   action per card id (`close` beats a pending `button`), sequenced by
   occurrence. **Dismissal authority stays the plugin's** — today "neither
   action crosses the contract (dismissal authority stays the plugin's — a
   locally closed card just ignores later card.state/complete records)"
   (`CardPlayerSurface.swift:218-223`); v1 makes the local close
   *observable*, never authoritative: the producer hears the close and may
   react (post `card.dismiss`, re-present, stop its loop); it does not
   receive control of the surface.
2. **`question.answer` with `outcome`** settles the parked ask — the
   vendored service's waterfall resolves by any listener answering first
   (`question-bridge.js:4-6`), and the bridge maps a `cancelled` outcome to
   the service's settle (implementation rides Batch 1). `question.decided`
   keeps its post-settle position (`question-bridge.js:34-35`).
3. **`notify.response`** stays the frozen §5 event channel; the shipped
   order — `notify.response` then `app.state` "foreground" — is pinned as
   family behavior (iOS `NotifyPrimitive.swift:84-94`).
4. **Approval/picker/notify results ride the frozen primitive settle** — no
   new events (the A2UI fold's zero-new-channel discipline, held).

### 5. The degradation ladder (never crash, never silent)

Ordered rules every face renderer implements:

1. **Unknown face type or unknown `kind` → render the generic form** (title
   + text), one structured warn through the host's unified log channel
   (the `GatewayCore.uiMarker` / `hilog` / `android.Log` family); never
   throw, never drop silently. This is the ask's "unknown face type =
   honest degradation generic".
2. **`schemaVersion` above the host's known max → legacy render + warn**
   (ignore unknown fields — the documented tolerance).
3. **Unknown fields → ignored** (today's behavior, now declared).
4. **Required field missing → not rendered + one structured warn naming the
   frame and the field** — replacing today's silent drop
   (`CardPlayerSurface.swift:76-77` returns with nothing logged). The
   honesty fix is the log, not the render: the producer contract documents
   the drop, so the drop stays — silently dropping is what changes.
5. **Primitive-payload malformation keeps the frozen `invalid` refusals**
   (`UiPrimitives.kt:138-145` mode; `NotifyPrimitive.kt:46-47` title;
   `OfficialServe.ets:1253-1256` bad args).

### 6. The boundary: primitives stay irreducible

`presentApproval`, `presentPicker`, `notify` are Tier A consent surfaces —
"a user-facing OS surface is itself the trust boundary" (the 2026-11-11
slimming round's classification). This proposal changes **zero rows**: no
new primitives (§8 restraint), no shape edits (D5), no result changes —
`{approved, remember?}`, `{scope, path} | null`, `{id}` stay byte-for-byte.
R3 unifies ONLY the payload schemas riding above them and the bus faces
beside them. Security-bearing validation (permission flags, audit records,
the §6 audit trail) is untouched — the slimming round's boundary rule
("security-bearing validation STAYS at the gateway") extends to the payload
layer: nothing in `face.*@1` carries authority.

### 7. Host obligations and the three-batch migration

**Obligation (every host, at its batch):** a face renderer that
(a) reads `schemaVersion`, (b) renders `face.*@1`, (c) degrades per §5 with
logged warns, (d) posts action events per §4. No `hostType` branching
(RFC 0002): which faces a host renders is negotiated capability expressed
in code paths, never platform conditionals in shared logic.

| Batch | Host | Faces | Why this order | Acceptance = scenario legs (D7: structured logs, unique scenario-id, one-to-one expected ↔ logged) |
| --- | --- | --- | --- | --- |
| 1 (pilot) | iOS | card + question + approval | the only host where every face renders natively today (card player, question dialog, the approval ladder ×3 including the only installed BLE prompter, picker, notify) and the census's two strongest candidates + the consolidation live here | the card-player leg extended (`runtime/dsh/scenario/card-player.js:39-63` + `schemaVersion` + a `card.action` round-trip); a question leg whose cancel delivers `outcome:"cancelled"` (the park-forever defect dies); the mount-approval leg shows the detail line (the `message` drift fix, `plugin-mount.js:146`) |
| 2 | Android | approval family + question + card | the ladder exists as three hand-rolled dialogs; the question renderer is genuinely lossy (longest-string labels, ≤3-button ceiling — `QuestionDialog.kt:58-69,138-139`); installing the dormant prompter becomes a payload read | the same three legs on the Android seat (`runtime/dsh/scenario/gateway-binding.js:188-218` precedent) |
| 3 | harmony | card + approval payload (+ picker/notify alignment) | the approval parser widens from `{title}` to the family shape (`OfficialServe.ets:1246-1258`); harmony's question face does not exist (the WebView answers) — native 问询 is its own follow-up (the ApprovalDialog widening), honestly deferred here | `harmony-capability-binding.js` legs re-run; the card leg exercises the ArkTS face (`CardFace.ets:47-82`) |

**Deferred and named:** the native appshell/A2UI renderer (zero
Swift/Kotlin/ArkTS consumers exist; the census's "biggest gap, biggest
cost, honest deferral candidate"); settings-row (§1); picker
filters/multi-select; notify actions; structured approval risk. The
**render-intent dispatch layer** — wiring the #764 presenters'
`presentationMeta`/`presentCall`/`presentResult` to these faces — is the
sibling work item in the same program (task T-0290), consuming the
referenced vocabulary; it is NOT part of this proposal's fold.

## Non-goals

- **Any edit to a frozen shape** (D5): primitives table rows, primitive
  results, `surface.ops@1`, `a2ui.messages@0.9` — all byte-identical.
- **New primitives or new event channels** — the restraint rule and the
  A2UI fold's zero-channel discipline both hold.
- **Forced migration of legacy producers** — v0 frames (no `schemaVersion`)
  render identically forever; the additive contract has no deprecation
  clock on bus faces.
- **A native appshell/A2UI renderer** — deferred with the census evidence.
- **Touching vendored packages** (D6): the tool-card vocabulary is consumed
  as pinned, never edited.

## Alternatives considered

- **Fold the native faces into `a2ui.messages@0.9`** — rejected: A2UI is the
  session-content tier for WebView/Lynx renderers; the native faces are
  coarser, OS-surface-bound payloads (a PiP card, an alert ladder, a
  notification) that must render when no WebView is live and when the OS
  owns the chrome. Two declared tiers with an honest bridge beat one format
  stretched across both.
- **One umbrella `face.present` envelope dispatching all faces** — rejected:
  the channels genuinely differ (bus lines vs primitive payloads); an
  umbrella would re-route frozen channels and re-invent the dispatch the
  primitives already own.
- **Wait for upstream DSH to standardize** — rejected: upstream's
  `presentation.d.ts` covers tool cards only; the bus faces and payload
  faces are ours, and the census defects (parked asks, unread `message`)
  are live now.
- **Per-host schemas (the status quo, named)** — rejected: the census's
  drift list IS the status quo's cost — five renderers holding one shape by
  symmetry, three ladders by copy-paste, and a detail key no host reads.

## Evidence

- The four R3 censuses (iOS, Android, harmony, producers; 2026-11-12) are
  the corpus; every field table above cites its census `path:line`, and the
  load-bearing citations were re-verified in this seat at git `8ebde204`:
  the producer card contract (`dsh-create/index.js:110-115`), the question
  bridge (`question-bridge.js:1-38`), the iOS faces
  (`CardPlayerSurface.swift:64-121,218-232`, `SessionQuestions.swift:1-59`,
  `UIPrimitives.swift:28-130`, `ClipboardPrimitives.swift:10-65`,
  `BLEPrimitives.swift:45-114`, `NotifyPrimitive.swift:20-94`,
  `SessionServe.swift:398-462`), the Android faces
  (`QuestionDialog.kt:50-160`, `UiPrimitives.kt:39-150`,
  `ClipboardPrimitives.kt:40-82`, `BleConsent.kt:55-95`,
  `NotifyPrimitive.kt:40-69`, `CardSurface.kt:60-135`,
  `CarrierIndexRows.kt:20-50`), the harmony faces
  (`CardFace.ets:40-134`, `Index.ets:1348-1372`,
  `OfficialServe.ets:1244-1259`, `DevicePlanePrimitives.ets:55-68`,
  `PickerPrimitives.ets:42-71`, `HostPhase.ets:180-190,888,1110-1155`,
  `EntryAbility.ets:34-52`), the web sibling
  (`presentation/web-client-v2/web/js/card-face.js:1-12`, `main.js:58-70`),
  and the scenario precedent (`runtime/dsh/scenario/card-player.js:36-66`).
- The frozen neighbors this proposal mirrors: data-protocols.md §6
  (versioning, :109-116), §9 `surface.ops@1`, §10 `a2ui.messages@0.9`
  (:234-279); primitives.md §4 (the one-sentence payload prose for
  notify/presentApproval/presentPicker) and §8 (restraint).
- The producer-side convergence and its consumer gap: the vendored
  vocabulary
  (`runtime/dsh/vendor/dsh/tools@0.1.6-alpha.2/lib/types/presentation.d.ts`),
  the pinning test (`test/panel/tool-card-face.test.js`, 18/18 green in the
  producer census run), and the absence of native consumers (census greps:
  `presentationMeta|presentCall|presentResult` zero matches in
  `hosts/ios/App/Source`; `@Composable`/appshell zero native matches on
  Android; zero ArkTS consumption of `app-shell/0.9`).
- The approval-drift triple: `plugin-mount.js:139-149` (the `{title,
  message}` call), the three host parsers (cited in §2), and the dormant
  Android prompter seam (repo-wide `capabilityPrompter` grep — one hit,
  iOS `BLEPrimitives.swift:50`).
- The live defects the family fixes: the parked-ask cancel
  (`SessionQuestions.swift:55`, `QuestionDialog.kt:114`,
  `question-bridge.js:10-12`), the silently dropped id
  (`CardPlayerSurface.swift:76-77`), the unread `message` key
  (`plugin-mount.js:146` vs `UIPrimitives.swift:39-41`), the `'DSH'`
  default (`HostPhase.ets:888`).

## Sizing

M for the fold (data-protocols.md §11 + the contract README pointer + the
two producer-side one-liners: the `plugin-mount` detail fix and the
question-bridge outcome mapping); M per host batch (renderer + legs),
L across the program. The render-intent dispatch layer and the pilot
wiring are the sibling T-0290 items sized separately.
