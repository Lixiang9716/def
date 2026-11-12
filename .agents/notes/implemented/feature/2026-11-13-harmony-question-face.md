# Harmony's native question face — face.question@1 dialog, scripted cancel, scenario leg

Status: implemented

## Problem

The R3 face.*@1 proposal's batch 3 deferred harmony's native question face
("the WebView answers — native 问询 is its own follow-up, honestly deferred
here"). On the drive seat that deferral left a hole, not a platform choice:
a `question.request` on the HostPhase seat fell through `onBusLine` on the
floor — no WebView was mounted on the drive legs to answer it, so the
question bridge's parked ask waited forever. Android got its
QuestionDialog.kt and iOS its SessionQuestions.swift; the park-forever
defect (取消 answered nothing, so no `question.answer` ever settled the
ask) died on those two hosts but had never even been reachable on harmony's
drive seat. Separately, the same task's runner is the sibling of
`ci/run-card-player.sh`, whose launch (`--ps dsh.e2e.leg card.player`) had
been dead on main since the #464 salvage deliberately dropped the
Index.ets leg wiring ("must be replayed on main's terminal state in a
follow-up") and no follow-up ever landed.

## Decision

- `model/QuestionDialog.ets` — the face's model half: `QuestionFace.parse`
  (face.question@1: `{id, label}` options canonical, a bare string reads as
  both, alien shapes drop with one structured warn; `id` required — a
  missing id refuses with a warn per data-protocols §11's degradation
  ladder, replacing Android's silent return) and `QuestionFace.run` (one
  presenter call per question — multi-question asks chain; the settle is
  exactly-once; answers carry option **ids**, never echoed labels; cancel
  aborts the chain and delivers `outcome:"cancelled"`; legacy frames — no
  schemaVersion — stay byte-shaped without `outcome`).
- `HostPhase.onBusLine` routes `question.request` to the registered bus
  face (the Android BindingHost arm, mirrored); the answer rides
  `hostBusDeliver` — the deliverRuntime equivalent — and
  `signalComplete` watches the status like every other bus delivery. With
  no presenter registered the arm refuses LOUD (hilog error, no delivery):
  on a verification seat a wiring bug must fail the leg's 30 s await, never
  auto-cancel into a false green.
- Index registers the bus face once in `aboutToAppear` (the approval
  presenter's posture) and presents `QuestionFaceDialog` — a @CustomDialog
  beside ApprovalDialog: options render as a button row PER option (not
  lossy past three), an option-less ask as free text, 取消 delivers
  cancelled. `autoCancel: false` — an outside tap is nothing, never a
  silent dismissal, so the whole park-forever family dies on harmony. The
  scripted-question seam arms per dialog (`--ps dsh.script.question
  cancel`: the dialog still presents, then settles exactly the way the
  tapped 取消 would ~350 ms in; the vocabulary is closed at EntryAbility —
  `cancel` alone, an unknown value stages nowhere).
- The `question.face` leg (card.player's headless shape, ONE launch),
  `test/e2e/scenarios/question-face-harmony.json` (the android manifest
  minus `client.selected` — no web client mounts), and
  `ci/run-question-face.sh` (build → install → PID-verified launch → hilog
  stream → capture pull → check.mjs → receipt).
- Staging: `scenario/question-face.js` joins `BUNDLE_FILES` (a derived
  graph root), `harmony-closure-spine.rows` (policy), the vendor-official.sh
  SPINE_OURS splice, and the committed rawfile copy (`build/build.sh sync
  harmony`; check-bundle-files 1254 = 1254).
- The card.player arm replay rides as its own commit — the salvage named
  it, the arm is the dispatch-table shape this task adds a sibling to, and
  the calibrator runner cannot run without it.

## Alternatives considered

- Serving the ask through the WebView on drive legs — rejected: the
  headless legs mount no page, and the leg exists to prove the NATIVE face;
  the WebView seat (OfficialServe/release) keeps answering in-page,
  untouched — exactly the batch-3 posture, now with the drive seat honest.
- Reusing `presentApproval` for asks — rejected: face.question@1 is its own
  frozen family (multi-question chains, option ids, the outcome
  vocabulary); a fourth hand-rolled consent dialog is what the proposal
  explicitly declined.
- Emitting carrier-side records for the dialog's acts (presented /
  script-fired markers) — rejected: the manifests are one-to-one with
  nothing extra; the dialog's evidence rides hilog, the scenario's own
  stream judges.
- Exporting the @CustomDialog struct from the model file — rejected: no
  exported-struct precedent in this tree; the struct stays in Index.ets
  beside ApprovalDialog, the parse/chain/settle in the model file (the
  QuestionDialog.kt split, mirrored).
- Leaving the card.player arm out (strict task scope) — rejected: the
  salvage commit itself mandates the replay, and a question-face runner
  calibrated on a sibling runner that cannot launch would be a poor
  precedent.
