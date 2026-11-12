# R3 native faces — batches 2/3: the Android + harmony hosts join the face.*@1 renderers

Status: implemented

## Problem

The R3 proposal (`contract/proposals/2026-11-12-native-face-schemas.md`, DRAFT) left the
Android and harmony hosts on their pre-face renderers after the iOS pilot (#765): Android's
`CardSurface.kt` still dropped a `card.present` missing its id silently, held the open kind
string with no closed set, had zero interactive card elements beyond the local ✕, and posted
no `card.action` events; `QuestionDialog.kt` answered options by their LONGEST string value
("the key VARIES by model whim"), capped options at three dialog buttons with a lossy
free-text fallback past that, and its 取消 dismissed without answering — the same
park-forever defect the iOS pilot killed on iOS (a cancelled ask settles the parked turn;
Android's left it waiting forever). Harmony's `CardFace.ets` silently dropped a missing id,
had no schemaVersion read, and — drift found during this batch — the page read the REDACTED
`snapshot()` projection for its own bindings (`Index.ets` `refreshCardFace`), so every
title/time/label binding rendered its `?? ''` fallback while the documented page consumer of
the full projection is `faceCard()`. The proposal's batch table also deferred settings-row
("no native settings face exists on any host — inventing it now would freeze a face reality
does not serve"), which decides the settings ask without new vocabulary.

## Decision

Batch 2 (Android) — the iOS pilot's exact posture, Kotlin-spelled:

- `CardSurface.kt` is a generic face.card@1 renderer: `schemaVersion` read (a future version
  renders legacy + one `card-degrade schema-N` warn), missing card/id refused AND warned
  (`missing-card` / `missing-id` — the honesty fix for the silent drop), kind a closed set
  degrading to `info` with a warn, declarative `card.actions: [{id, label}]` rendered as a
  real button row (malformed entries drop with one warn; explicit string reads — `optString`
  would coerce a number), and the user's acts (✕ close, drag end, button tap) return to the
  runtime as `card.action` events over `postAction` — the SAME bus-delivery bridge the
  question answer rides (`deliverRuntime` → `m4BusDeliver` on both the drive seat
  (`BindingHost`) and the serving seat (`SessionServe`)). The close is terminal-once per
  presented card and OBSERVABLE, never authoritative. The scripted-action test seam
  (`--es dsh.script.card-action button:<id>`) fires at complete+1s like a tap.
- `QuestionDialog.kt` is a face.question@1 renderer: canonical `{id, label}` option
  normalization (bare strings accepted as both; alien shapes drop with one structured warn),
  answers identify options by id, the longest-string heuristic and the ≤3-button ceiling are
  retired (every option renders as its own button row — the 2026-10-29 emulator finding was
  that item LISTS collapse, buttons don't), and 取消 DELIVERS `question.answer` with
  `outcome:"cancelled"` (versioned requests only; legacy frames stay byte-shaped) — the
  park-forever defect dies on Android too. The scripted-question seam
  (`--es dsh.script.question cancel`) settles exactly the way the tapped 取消 would.
- The drive seat routes `question.request` to the native dialog (`BindingHost.busPosted`),
  and the `question.face` scenario (unchanged from the iOS leg — one leg serves every seat)
  rides a new `--ez dsh.questionface` drive with its runner (`hosts/android/ci/run-question-face.sh`)
  and manifest (`question-face-android.json`). `card-player-android.json` pins the new
  `card.action.received` round-trip.

Batch 3 (harmony) — same posture, ArkTS-spelled: `CardFace.ets` reads `schemaVersion`,
refuses a missing id with a `card-degrade` hilog warn (the ladder's honesty voice through
the host's unified channel), degrades unknown kinds, projects the declarative actions, and
posts `card.action` close/button events over a seat-wired `actionSink` (`deliverEvent` on
`HostPhase`, `deliverRuntimeEvent` on `OfficialServe` — the same host→runtime event channel
the primitives' emitters use). `Index.ets` renders the action button row and its ✕ now posts
the observable close. The page's projection read moves to `faceCard()` (the drift fix
above). Harmony's question face stays N/A per the census (the WebView answers; no native
dialog exists) — honestly deferred as the proposal's batch-3 row records. Local harmony
verification is deferred too: `hdc` is on PATH but lists no device, and no hvigor/DevEco
toolchain exists on this seat — CI's `harmonyos-build` is the bottom line.

Staging truth in the same change: the Android scenario embed list gained `card-player.js`
(its committed asset copy had drifted past every gate — #765's action-round-trip never
reached the APK; the stage/verify lists now pin it) and `question-face.js`, with the
generated staging rows re-derived (`android-scenario{,.policy}.rows` +2).

Settings disposition: unchanged, per the proposal — settings-row stays deferred-and-named
(§1/§7); the settings surfaces the scenario legs prove are api-driven rows over the wire,
not render-intent faces, so there is nothing to merge into the dispatch layer and inventing
`face.settings-row@1` would contradict the proposal's own restraint record.

## Alternatives considered

- **Keep Android's 3-button positive/neutral/negative rendering and its free-text fallback
  past three options** — rejected: the proposal names the ceiling as the renderer's lossiness
  to fix; a custom-view button row is the same dialogs-can't-collapse insight the 2026-10-29
  measurement produced, without the ceiling.
- **Route harmony's ✕ close without an action event (status quo, now with buttons)** —
  rejected: the D8 action-return contract is the point of the family; a host that can post
  events and doesn't re-creates the unobservable-close asymmetry the pilot fixed.
- **Invent `face.settings-row@1` to merge the settings surfaces into the dispatch layer** —
  rejected: the proposal's §1 census found no native settings face on any host and declined
  the family ("freeze a face reality does not serve"); the ask's fallback contradicts the
  adjudicated file, and the files govern.
- **Commit the concurrent R1 stream's in-flight files alongside this batch** (the seat
  carries both work streams; `boot.js`/`def-bundle.js` and their staging mirrors were
  mid-flight in the same tree) — rejected: half-done parallel work must not ride a split
  commit; the R1 files stay unstaged and byte-consistent in the working tree for their own
  landing.

## Consequences

Both Android legs are green on a live emulator with one-to-one manifest judging
(`card.player` 13/13 including the declarative-action round-trip; `question.face` 10/10 with
the cancel settling the parked turn — receipts under `hosts/android/artifacts/{card-player,
question-face}/`). The legacy frames keep byte-shaped behavior on every host (schemaVersion
absent = today's behavior), so no producer is forced to migrate. The fold into
data-protocols.md §11 remains the owner's call (🔒), and the plan.md §14 R3 row stays open
for exactly that fold — the host batches it names now exist.
